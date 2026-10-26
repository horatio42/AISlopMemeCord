import { ApiError, json, noContent, type Router } from '../http';
import { ValidationError } from '../util/validate';
import {
  saveUpload, assertUploadVisible, assertMessageVisible, isPublicPurpose,
  serveStoredFile, safeMediaPath, type UploadRow, type AttachmentRow,
} from '../services/media';
import { unlinkSync } from 'node:fs';

export function register(router: Router) {
  router.post('/api/uploads', async (ctx) => {
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw new ApiError(400, 'INVALID_MULTIPART', 'Send multipart/form-data with a file and a purpose. Form data is not a suggestion.');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError({ file: 'Attach a real file in the `file` field, not a mystery.' });
    const upload = await saveUpload(ctx, file, form.get('purpose'));
    return json({ upload }, 200);
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.get('/api/media/uploads/:id', (ctx) => {
    const row = ctx.db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', ctx.params.id ?? '');
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'That upload never existed, or the goblins ate it.');
    assertUploadVisible(ctx, row);
    return serveStoredFile(ctx, {
      storedPath: row.path,
      contentType: row.content_type,
      sha256: row.sha256,
      filename: row.filename,
      cache: row.purpose === 'attachment' || row.message_id ? 'no-store' : isPublicPurpose(row.purpose) ? 'immutable' : 'no-store',
    });
  });

  router.get('/api/attachments/:id', (ctx) => {
    const row = ctx.db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', ctx.params.id ?? '');
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'That attachment is not in the database. It may have been deleted.');
    assertMessageVisible(ctx, row.message_id);
    return serveStoredFile(ctx, {
      storedPath: row.path,
      contentType: row.content_type,
      sha256: row.sha256,
      filename: row.filename,
      cache: 'no-store',
    });
  });

  router.delete('/api/uploads/:id', (ctx) => {
    const row = ctx.db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', ctx.params.id ?? '');
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such upload to delete. It is already free.');
    if (row.owner_id !== ctx.user!.id) throw new ApiError(403, 'FORBIDDEN', 'You can only delete your own uploads. Borrowed slop is not yours.');
    const attached = row.message_id
      ? ctx.db.get('SELECT 1 FROM messages WHERE id = ?', row.message_id)
      : ctx.db.get('SELECT 1 FROM attachments WHERE id = ? OR path = ? LIMIT 1', row.id, row.path);
    if (attached) throw new ApiError(409, 'UPLOAD_IN_USE', 'That upload is attached to a message. Detach it first, or delete the message.');
    ctx.db.run('DELETE FROM uploads WHERE id = ?', row.id);
    try { unlinkSync(safeMediaPath(ctx.config, row.path)); } catch { /* file may already be gone */ }
    return noContent();
  });
}
