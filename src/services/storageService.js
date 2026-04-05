import { google } from 'googleapis';
import { Readable } from 'stream';
import env from '../config/env.js';
import { getGoogleAuthClient } from '../config/googleAuth.js';

const getDrive = () => {
  const auth = getGoogleAuthClient();
  return google.drive({ version: 'v3', auth });
};

/**
 * Find or create a folder in Google Drive.
 * Uses GDRIVE_ROOT_FOLDER_ID as parent if set, otherwise root.
 */
const getOrCreateFolder = async (drive, folderName) => {
  const parent = env.gdriveRootFolderId || 'root';

  // Check if folder already exists
  const res = await drive.files.list({
    q: `name='${folderName}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    },
    fields: 'id',
  });

  return folder.data.id;
};

/**
 * Upload a file buffer to Google Drive and return a public URL.
 * @param {Buffer} fileBuffer
 * @param {string} originalName
 * @param {string} mimeType
 * @param {string} folder - folder name in Drive
 * @returns {{ url: string, filePath: string }}
 */
export const uploadFile = async (fileBuffer, originalName, mimeType, folder = 'uploads') => {
  const drive = getDrive();
  const folderId = await getOrCreateFolder(drive, folder);

  const file = await drive.files.create({
    requestBody: {
      name: originalName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink, webContentLink',
  });

  // Make file publicly readable
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const isImage = mimeType.startsWith('image/');
  // Images are served via our own proxy to avoid Google Drive CORS/embedding issues
  const url = isImage
    ? `/api/v1/image-proxy?id=${file.data.id}`
    : `https://drive.google.com/uc?id=${file.data.id}&export=download`;

  return {
    url,
    filePath: file.data.id, // Store Drive file ID as filePath
  };
};

/**
 * Delete a file from Google Drive.
 * @param {string} fileId - the Google Drive file ID
 */
export const deleteFile = async (fileId) => {
  try {
    const drive = getDrive();
    await drive.files.delete({ fileId });
    return { success: true };
  } catch (error) {
    console.error(`Drive delete error: ${error.message}`);
    return { success: false, error: error.message };
  }
};

export default { uploadFile, deleteFile };
