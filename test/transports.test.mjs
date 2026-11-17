// Transport tests: MEX (w:mex IQ), HTTPS GraphQL (www / facebook / wamo) and passkey methods.
// Uses Node's built-in test runner. No WhatsApp connection is opened; fetch and the
// socket query function are mocked.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeWMexQuery } from '../lib/Socket/mex.js';
import {
    makeGraphQLSocket,
    executeWWWGraphQL,
    executeFacebookGraphQL,
    executeWamoGraphQL
} from '../lib/Socket/graphql.js';
import { makePasskeySocket, PASSKEY_MEX_IDS } from '../lib/Socket/passkey.js';
import { S_WHATSAPP_NET } from '../lib/WABinary/index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

const DEFAULT_TOKEN = 'WA|1015890928915437|3201f239340c1c8ec6262a6dad04200e';

/** Replace global fetch with a handler and record every call. */
const mockFetch = handler => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
    };
    return calls;
};

const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake socket.query that answers every w:mex IQ with the given JSON body. */
const mexSocket = replyJson => {
    const sent = [];
    const query = async node => {
        sent.push(node);
        return {
            tag: 'iq',
            attrs: {},
            content: [{ tag: 'result', attrs: {}, content: Buffer.from(JSON.stringify(replyJson)) }]
        };
    };
    return { sent, query, generateMessageTag: () => 'tag-1' };
};

// ── MEX transport ─────────────────────────────────────────────────────────────

test('MEX: sends a w:mex get IQ with query_id and JSON variables', async () => {
    const { sent, query, generateMessageTag } = mexSocket({ data: { xwa2_thing: { ok: true } } });

    const out = await executeWMexQuery({ jid: 'a@s.whatsapp.net' }, '123', 'xwa2_thing', query, generateMessageTag);

    assert.deepEqual(out, { ok: true });
    const iq = sent[0];
    assert.equal(iq.tag, 'iq');
    assert.equal(iq.attrs.xmlns, 'w:mex');
    assert.equal(iq.attrs.type, 'get');
    assert.equal(iq.attrs.to, S_WHATSAPP_NET);
    assert.equal(iq.attrs.id, 'tag-1');
    const q = iq.content[0];
    assert.equal(q.tag, 'query');
    assert.equal(q.attrs.query_id, '123');
    assert.deepEqual(JSON.parse(q.content.toString('utf-8')), { variables: { jid: 'a@s.whatsapp.net' } });
});

test('MEX: returns the whole data object when dataPath is empty', async () => {
    const { query, generateMessageTag } = mexSocket({ data: { a: 1 } });
    const out = await executeWMexQuery({}, '1', '', query, generateMessageTag);
    assert.deepEqual(out, { a: 1 });
});

test('MEX: GraphQL errors reject with a Boom carrying the error_code', async () => {
    const { query, generateMessageTag } = mexSocket({
        errors: [{ message: 'not allowed', extensions: { error_code: 403 } }]
    });
    await assert.rejects(
        executeWMexQuery({}, '1', 'xwa2_thing', query, generateMessageTag),
        err => {
            assert.equal(err.isBoom, true);
            assert.equal(err.output.statusCode, 403);
            assert.match(err.message, /not allowed/);
            return true;
        }
    );
});

test('MEX: a reply without the requested data path rejects with a readable action name', async () => {
    const { query, generateMessageTag } = mexSocket({ data: {} });
    await assert.rejects(
        executeWMexQuery({}, '1', 'xwa2_get_thing', query, generateMessageTag),
        /Failed to get thing/
    );
});

test('MEX: a reply with no result node rejects', async () => {
    const query = async () => ({ tag: 'iq', attrs: {}, content: [] });
    await assert.rejects(executeWMexQuery({}, '1', 'xwa2_x', query, () => 't'), /Failed to x/);
});

test('MEX: exposed on the GraphQL socket as executeWMexQuery', async () => {
    const { sent, query, generateMessageTag } = mexSocket({ data: { xwa2_exposed: 'yes' } });
    const sock = makeGraphQLSocket({ query, generateMessageTag });
    const out = await sock.executeWMexQuery({ k: 'v' }, '999', 'xwa2_exposed');
    assert.equal(out, 'yes');
    assert.equal(sent[0].content[0].attrs.query_id, '999');
});

// ── HTTPS GraphQL transport ───────────────────────────────────────────────────

test('HTTPS www: posts doc_id/variables/lang with the default token and returns the data path', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { xwa2_meta: { v: 1 } } }));

    const out = await executeWWWGraphQL(26061411083512356, { a: 1 }, undefined, 'xwa2_meta', 'fr');

    assert.deepEqual(out, { v: 1 });
    assert.equal(calls[0].url, 'https://graph.whatsapp.com/graphql');
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.access_token, DEFAULT_TOKEN);
    assert.equal(body.doc_id, '26061411083512356');
    assert.deepEqual(body.variables, { a: 1 });
    assert.equal(body.lang, 'fr');
});

test('HTTPS www: an explicit access token overrides the default', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { x: 1 } }));
    await executeWWWGraphQL('1', {}, 'my-token', 'x');
    assert.equal(JSON.parse(calls[0].init.body).access_token, 'my-token');
});

test('HTTPS www: GraphQL errors reject with a Boom using the extension error_code', async () => {
    mockFetch(() => jsonResponse({ errors: [{ message: 'bad doc', extensions: { error_code: 422 } }] }));
    await assert.rejects(executeWWWGraphQL('1', {}, undefined, 'x'), err => {
        assert.equal(err.output.statusCode, 422);
        assert.match(err.message, /bad doc/);
        return true;
    });
});

test('HTTPS www: non-2xx HTTP status rejects with that status code', async () => {
    mockFetch(() => new Response('nope', { status: 503 }));
    await assert.rejects(executeWWWGraphQL('1', {}, undefined, 'x'), err => {
        assert.equal(err.output.statusCode, 503);
        return true;
    });
});

test('HTTPS facebook: uses the acs.whatsapp.com endpoint', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { y: 2 } }));
    const out = await executeFacebookGraphQL('7', {}, 'tok', 'y');
    assert.equal(out, 2);
    assert.equal(calls[0].url, 'https://acs.whatsapp.com/graphql');
});

test('HTTPS wamo: form-encodes the request to /api/wamo/graphql/ on the configured host', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { z: 3 } }));
    const out = await executeWamoGraphQL('55', { q: 1 }, { accessToken: 'at', credential: 'cred', userId: 42 }, 'z', 'wamo.example.test');

    assert.equal(out, 3);
    assert.equal(calls[0].url, 'https://wamo.example.test/api/wamo/graphql/');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(calls[0].init.body);
    assert.equal(params.get('access_token'), 'at');
    assert.equal(params.get('credential'), 'cred');
    assert.equal(params.get('user_id'), '42');
    assert.equal(params.get('doc_id'), '55');
    assert.deepEqual(JSON.parse(params.get('variables')), { q: 1 });
});

test('HTTPS socket: calls without a nonce method fall back to the default token (no TypeError)', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { xwa2_meta_config_fetch: { ok: 1 } } }));
    const sock = makeGraphQLSocket({ query: async () => ({}), generateMessageTag: () => 't' });

    const out = await sock.metaConfigFetch();

    assert.deepEqual(out, { ok: 1 });
    assert.equal(JSON.parse(calls[0].init.body).access_token, DEFAULT_TOKEN);
});

test('HTTPS socket: when nonce methods exist, the exchanged token is used and cached', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { xwa2_meta_config_fetch: {} } }));
    let nonceCalls = 0;
    const sock = makeGraphQLSocket({
        query: async () => ({}),
        generateMessageTag: () => 't',
        wwwGetNonce: async () => { nonceCalls++; return { nonce: 'n1' }; },
        wwwExchangeNonce: async nonce => ({ access_token: `tok-for-${nonce}` })
    });

    await sock.metaConfigFetch();
    await sock.metaConfigFetch();

    assert.equal(nonceCalls, 1, 'nonce exchange should run once and be cached');
    assert.equal(JSON.parse(calls[0].init.body).access_token, 'tok-for-n1');
    assert.equal(JSON.parse(calls[1].init.body).access_token, 'tok-for-n1');
});

test('HTTPS socket: setAccessToken overrides the nonce flow', async () => {
    const calls = mockFetch(() => jsonResponse({ data: { xwa2_meta_config_fetch: {} } }));
    const sock = makeGraphQLSocket({
        query: async () => ({}),
        generateMessageTag: () => 't',
        wwwGetNonce: async () => { throw new Error('should not be called'); },
        wwwExchangeNonce: async () => { throw new Error('should not be called'); }
    });
    sock.setAccessToken('manual-token');
    await sock.metaConfigFetch();
    assert.equal(JSON.parse(calls[0].init.body).access_token, 'manual-token');
});

// ── Passkey methods (over MEX) ────────────────────────────────────────────────

const passkeySocket = replyJson => {
    const { sent, query, generateMessageTag } = mexSocket(replyJson);
    return { sent, sock: makePasskeySocket({ query, generateMessageTag, marker: 'kept' }) };
};

test('passkey: passkeyExists queries the PASSKEY_EXIST id and returns its response', async () => {
    const { sent, sock } = passkeySocket({ data: { xwa2_passkey_exist_response: { exists: true } } });
    const out = await sock.passkeyExists();
    assert.deepEqual(out, { exists: true });
    assert.equal(sent[0].content[0].attrs.query_id, PASSKEY_MEX_IDS.PASSKEY_EXIST);
});

test('passkey: verify challenge maps the WebAuthn fields to the server variables', async () => {
    const { sent, sock } = passkeySocket({ data: { xwa2_passkey_verify_challenge: { ok: true } } });
    await sock.passkeyVerifyChallenge('cid', 'authdata', 'clientjson', 'sig');
    const q = sent[0].content[0];
    assert.equal(q.attrs.query_id, PASSKEY_MEX_IDS.PASSKEY_VERIFY_CHALLENGE);
    assert.deepEqual(JSON.parse(q.content.toString('utf-8')).variables, {
        credential_id: 'cid',
        authenticator_data: 'authdata',
        client_data_json: 'clientjson',
        signature: 'sig'
    });
});

test('passkey: registration finish uses the attestation fields and its own data path', async () => {
    const { sent, sock } = passkeySocket({ data: { xwa2_reg_passkey_finish_register: {} } });
    await sock.regPasskeyFinish('cid', 'att', 'cj');
    const q = sent[0].content[0];
    assert.equal(q.attrs.query_id, PASSKEY_MEX_IDS.REG_PASSKEY_FINISH);
    assert.deepEqual(JSON.parse(q.content.toString('utf-8')).variables, {
        credential_id: 'cid',
        attestation_object: 'att',
        client_data_json: 'cj'
    });
});

test('passkey: payments toggle uses the PAYMENTS toggle-on id', async () => {
    const { sent, sock } = passkeySocket({ data: { xwa2_payments_passkey_toggle_on: { enabled: true } } });
    const out = await sock.paymentsPasskeyToggleOn();
    assert.deepEqual(out, { enabled: true });
    assert.equal(sent[0].content[0].attrs.query_id, PASSKEY_MEX_IDS.PAYMENTS_PASSKEY_TOGGLE_ON);
});

test('passkey: the layer keeps the input socket members', () => {
    const { sock } = passkeySocket({ data: {} });
    assert.equal(sock.marker, 'kept');
    assert.equal(typeof sock.query, 'function');
});

test('passkey: every MEX id is a numeric string', () => {
    for (const [name, id] of Object.entries(PASSKEY_MEX_IDS)) {
        assert.match(id, /^\d+$/, `${name} should be numeric`);
    }
});
