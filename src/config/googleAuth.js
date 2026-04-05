import { google } from 'googleapis';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import env from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOKEN_PATH = resolve(__dirname, '../../.google-tokens.json');

let oauth2Client = null;

/**
 * Get or create a shared OAuth2 client.
 * Handles automatic access token refresh and persists new tokens.
 */
export const getGoogleAuthClient = () => {
  if (oauth2Client) return oauth2Client;

  oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri
  );

  // Load saved tokens if they exist
  const savedTokens = loadSavedTokens();

  if (savedTokens) {
    oauth2Client.setCredentials(savedTokens);
  } else {
    oauth2Client.setCredentials({
      refresh_token: env.googleRefreshToken,
    });
  }

  // Listen for new tokens (auto-refresh fires this)
  oauth2Client.on('tokens', (tokens) => {
    console.log('[Google Auth] New access token received');
    const current = loadSavedTokens() || { refresh_token: env.googleRefreshToken };
    const updated = { ...current, ...tokens };

    // If Google issues a new refresh token, save it
    if (tokens.refresh_token) {
      console.log('[Google Auth] New refresh token received — saving');
    }

    saveTokens(updated);
    oauth2Client.setCredentials(updated);
  });

  return oauth2Client;
};

/**
 * Proactively refresh the access token.
 * Called by cron to avoid token expiry during API calls.
 */
export const refreshAccessToken = async () => {
  try {
    const client = getGoogleAuthClient();
    const { credentials } = await client.refreshAccessToken();

    const current = loadSavedTokens() || { refresh_token: env.googleRefreshToken };
    const updated = { ...current, ...credentials };
    saveTokens(updated);
    client.setCredentials(updated);

    console.log('[Google Auth] Access token refreshed successfully');
    return { success: true };
  } catch (error) {
    console.error('[Google Auth] Token refresh failed:', error.message);

    if (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked')) {
      console.error('==========================================================');
      console.error('GOOGLE REFRESH TOKEN EXPIRED — Re-authorize the app:');
      console.error(`Visit: https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.googleClientId}&redirect_uri=${env.googleRedirectUri}&response_type=code&scope=https://www.googleapis.com/auth/calendar%20https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent`);
      console.error('==========================================================');
    }

    return { success: false, error: error.message };
  }
};

/**
 * Check if current tokens are valid.
 */
export const checkTokenHealth = async () => {
  try {
    const client = getGoogleAuthClient();
    const tokenInfo = client.credentials;

    if (!tokenInfo.access_token) {
      console.log('[Google Auth] No access token — refreshing...');
      return refreshAccessToken();
    }

    // Check if access token expires within 10 minutes
    const expiryDate = tokenInfo.expiry_date || 0;
    const tenMinutes = 10 * 60 * 1000;

    if (Date.now() > expiryDate - tenMinutes) {
      console.log('[Google Auth] Access token expiring soon — refreshing...');
      return refreshAccessToken();
    }

    console.log('[Google Auth] Tokens healthy');
    return { success: true };
  } catch (error) {
    console.error('[Google Auth] Health check failed:', error.message);
    return { success: false, error: error.message };
  }
};

function loadSavedTokens() {
  try {
    if (existsSync(TOKEN_PATH)) {
      return JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    }
  } catch {
    // ignore
  }
  return null;
}

function saveTokens(tokens) {
  try {
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('[Google Auth] Failed to save tokens:', error.message);
  }
}

export default { getGoogleAuthClient, refreshAccessToken, checkTokenHealth };
