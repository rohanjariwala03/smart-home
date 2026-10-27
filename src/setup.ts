import type { Connection } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';

import { useHA, type Creds } from '@/ha';

// Adding devices = HA config flows, the same API behind HA's "Discovered" list and
// "Add integration" dialog. All of it needs a token from an admin user.

export const ADMIN_ONLY =
  'Adding devices needs an administrator login. In Settings, use a token from an admin Home Assistant user.';

export type Flow = {
  flow_id: string;
  handler: string;
  step_id: string;
  context: { source: string; title_placeholders?: Record<string, string> };
};

// One field of a form step (voluptuous-serialize shape, or an HA selector).
export type Field = {
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  options?: [string, string][] | Record<string, string>;
  selector?: Record<string, any>;
  schema?: Field[];
  description?: { suggested_value?: unknown };
};

export type Step = {
  type: 'form' | 'create_entry' | 'abort' | 'external' | 'external_done' | 'progress' | 'progress_done' | 'menu';
  flow_id: string;
  handler: string;
  step_id?: string;
  data_schema?: Field[];
  errors?: Record<string, string | string[]> | null;
  description_placeholders?: Record<string, string> | null;
  menu_options?: string[] | Record<string, string>;
  reason?: string;
  title?: string;
  url?: string;
  progress_action?: string;
  translation_domain?: string;
};

async function rest(creds: Creds, method: string, path = '', body?: object) {
  const res = await fetch(`${creds.url}/api/config/config_entries/flow${path}`, {
    method,
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) throw new Error(ADMIN_ONLY);
  const json = await res.json().catch(() => ({}));
  // 400 with `errors` = the form rejected the input; the caller shows it on the form.
  if (!res.ok && !json.errors) throw new Error(json.message ?? `Home Assistant returned ${res.status}`);
  return json;
}

export const flows = (creds: Creds) => ({
  start: (handler: string): Promise<Step> => rest(creds, 'POST', '', { handler, show_advanced_options: false }),
  get: (id: string): Promise<Step> => rest(creds, 'GET', `/${id}`),
  submit: (id: string, data: object): Promise<Step | { errors: Record<string, string | string[]> }> =>
    rest(creds, 'POST', `/${id}`, data),
  abort: (id: string) => rest(creds, 'DELETE', `/${id}`).catch(() => {}),
});

/** Config-flow texts (titles, field labels, errors, option labels) for the given integrations. */
export function useTranslations(domains: string[]): Record<string, string> {
  const { conn } = useHA();
  const key = [...new Set(domains)].sort().join();
  const [resources, setResources] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!conn || !key) return;
    const get = (category: string) =>
      conn.sendMessagePromise<{ resources: Record<string, string> }>({
        type: 'frontend/get_translations',
        language: 'en',
        category,
        integration: key.split(','),
      });
    Promise.all([get('config'), get('selector')]).then(
      ([config, selector]) => setResources({ ...config.resources, ...selector.resources }),
      () => {},
    );
  }, [conn, key]);

  return resources;
}

export const fill = (text: string | undefined, values?: Record<string, string> | null) =>
  text && values ? text.replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m) : text;

/** Devices HA found on the network that are waiting to be set up. Empty for non-admin tokens. */
export function useDiscovered() {
  const { conn } = useHA();
  const [found, setFound] = useState<Record<string, Flow>>({});

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    let unsub: (() => Promise<void>) | undefined;
    conn
      .subscribeMessage<{ type: 'added' | 'removed' | null; flow_id: string; flow?: Flow }[]>(
        (events) =>
          setFound((prev) => {
            // Each (re)subscribe starts with the full list (type null), so flows gone during a disconnect or HA restart drop out.
            const next = events.every((e) => e.type === null) ? {} : { ...prev };
            for (const e of events) {
              if (e.type === 'removed' || !e.flow) delete next[e.flow_id];
              else next[e.flow_id] = e.flow;
            }
            return next;
          }),
        { type: 'config_entries/flow/subscribe' },
      )
      .then(
        (u) => {
          if (cancelled) u();
          else unsub = u;
        },
        () => {},
      );
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [conn]);

  const list = Object.values(found);
  const tr = useTranslations(list.map((f) => f.handler));
  return list.map((flow) => {
    const p = flow.context.title_placeholders;
    const title = fill(tr[`component.${flow.handler}.config.flow_title`], p) ?? p?.name ?? flow.handler;
    return { flow, title };
  });
}

export const ignoreFlow = (conn: Connection, flowId: string, title: string) =>
  conn.sendMessagePromise({ type: 'config_entries/ignore_flow', flow_id: flowId, title });

type Description = { name?: string; config_flow?: boolean; integration_type?: string; integrations?: Record<string, Description> };

/** Every integration that can be added from a phone: devices, hubs and cloud services. */
export async function listIntegrations(conn: Connection) {
  const res = await conn.sendMessagePromise<Record<'core' | 'custom', { integration?: Record<string, Description> }>>({
    type: 'integration/descriptions',
  });
  const out: { domain: string; name: string }[] = [];
  const walk = (all: Record<string, Description> = {}) => {
    for (const [domain, d] of Object.entries(all)) {
      if (d.config_flow && ['device', 'hub', 'service', undefined].includes(d.integration_type)) {
        out.push({ domain, name: d.name ?? domain });
      }
      walk(d.integrations);
    }
  };
  walk(res.core?.integration);
  walk(res.custom?.integration);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
