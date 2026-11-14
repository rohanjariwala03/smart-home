import * as Device from 'expo-device';
import { fetch } from 'expo/fetch';
import * as WebBrowser from 'expo-web-browser';
import { createConnection, createLongLivedTokenAuth } from 'home-assistant-js-websocket';

// "Sign in with Home Assistant": Home Assistant's own login page (OAuth, as its apps do), then the short-lived
// sign-in is swapped for a long-lived token. Everything else (widget, watch, Siri, alerts, live view) keeps using a
// plain token, and the token shows up in the person's profile, where they can revoke it.
//
// Home Assistant only sends the sign-in back to an app address that the client's own web page lists:
// docs/index.html, served by GitHub Pages at CLIENT_ID, says <link rel="redirect_uri" href="smarthome://auth">.
// So Home Assistant needs internet access once, to read that page. Without it, people paste a token instead.
export const CLIENT_ID = 'https://rohanjariwala03.github.io/smart-home/';
const REDIRECT = 'smarthome://auth';

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

const param = (url: string, key: string) => {
  const m = url.match(new RegExp(`[?&]${key}=([^&#]*)`));
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : undefined;
};

const form = (url: string, params: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: query(params),
  });

/** A long-lived token for `url`, or undefined if the person closed the login page. */
export async function signIn(url: string): Promise<string | undefined> {
  const state = Math.random().toString(36).slice(2);
  const page = `${url}/auth/authorize?${query({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, state })}`;
  const result = await WebBrowser.openAuthSessionAsync(page, REDIRECT, { preferEphemeralSession: true });
  if (result.type !== 'success') return undefined;
  if (param(result.url, 'state') !== state) throw new Error('The sign-in reply didn’t match. Try again.');
  const code = param(result.url, 'code');
  if (!code) throw new Error('Home Assistant didn’t send a sign-in code.');

  const res = await form(`${url}/auth/token`, { grant_type: 'authorization_code', code, client_id: CLIENT_ID });
  if (!res.ok) throw new Error(`Home Assistant refused the sign-in (${res.status}).`);
  const { access_token, refresh_token } = (await res.json()) as { access_token: string; refresh_token: string };

  const conn = await createConnection({ auth: createLongLivedTokenAuth(url, access_token) });
  try {
    return await conn.sendMessagePromise<string>({
      type: 'auth/long_lived_access_token',
      // Unique per sign-in, so signing in again on another phone (or again later) never clashes.
      client_name: `Smart Home app (${Device.deviceName ?? 'iPhone'}, ${new Date().toLocaleString()})`,
      lifespan: 3650,
    });
  } finally {
    conn.close();
    // Only the long-lived token is kept: end the sign-in session itself.
    form(`${url}/auth/revoke`, { token: refresh_token }).catch(() => {});
  }
}
