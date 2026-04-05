import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';
import { uploadFile } from '../services/storageService.js';

const router = Router();

router.use(authenticate);

router.post('/', uploadSingle('file'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded.',
      });
    }

    const folder = req.body.folder || 'uploads';

    const { url, filePath } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );

    return res.status(200).json({
      success: true,
      data: {
        url,
        filePath,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
      message: 'File uploaded.',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload file.',
    });
  }
});

export default router;
