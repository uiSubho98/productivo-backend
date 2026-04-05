import { Router } from 'express';
import { getGoogleAuthClient } from '../config/googleAuth.js';
import { google } from 'googleapis';

const router = Router();

// No auth — files are already public on Drive, and <img> tags can't send JWT headers

// GET /api/v1/image-proxy?id=DRIVE_FILE_ID
router.get('/', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: 'Missing file id' });

  try {
    const auth = getGoogleAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const meta = await drive.files.get({ fileId: id, fields: 'mimeType' });
    const mimeType = meta.data.mimeType || 'image/jpeg';

    const fileRes = await drive.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fileRes.data.pipe(res);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch image' });
  }
});

export default router;
