// Feature tests for the wbails-v2 ports: sendRichMessage payload and sendMessageMembers targeting.
// These modules have no runtime dependencies, so the tests need no WhatsApp connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRichMessageContent } from '../lib/Utils/rich-message.js';
import { selectGroupMemberJids } from '../lib/Utils/member-targets.js';

// ── sendRichMessage payload ──────────────────────────────────────────────────

test('rich: wraps the response in botForwardedMessage.richResponseMessage with messageType 1', () => {
    const msg = buildRichMessageContent({});
    const rich = msg.botForwardedMessage.message.richResponseMessage;
    assert.equal(rich.messageType, 1);
    assert.equal(rich.contextInfo.forwardedAiBotMessageInfo.botJid, '0@bot');
    assert.equal(rich.contextInfo.forwardOrigin, 4);
    assert.deepEqual(rich.contextInfo.botMessageSharingInfo, { botEntryPointOrigin: 1, forwardingScore: 1 });
});

test('rich: omits submessages, unifiedResponse and originalRecipientMetadata when not given', () => {
    const rich = buildRichMessageContent({}).botForwardedMessage.message.richResponseMessage;
    assert.equal('submessages' in rich, false);
    assert.equal('unifiedResponse' in rich, false);
    assert.equal('originalRecipientMetadata' in rich, false);
});

test('rich: passes submessages through unchanged', () => {
    const submessages = [{ messageText: 'hi' }, { messageText: 'there' }];
    const rich = buildRichMessageContent({ submessages }).botForwardedMessage.message.richResponseMessage;
    assert.deepEqual(rich.submessages, submessages);
});

test('rich: unifiedResponse and originalRecipientMetadata are base64 JSON that round-trips', () => {
    const unifiedResponse = { a: 1, nested: { b: [1, 2] } };
    const originalRecipientMetadata = { jid: 'x@s.whatsapp.net' };
    const rich = buildRichMessageContent({ unifiedResponse, originalRecipientMetadata })
        .botForwardedMessage.message.richResponseMessage;

    assert.equal(typeof rich.unifiedResponse, 'string');
    assert.deepEqual(JSON.parse(Buffer.from(rich.unifiedResponse, 'base64').toString('utf-8')), unifiedResponse);
    assert.deepEqual(
        JSON.parse(Buffer.from(rich.originalRecipientMetadata, 'base64').toString('utf-8')),
        originalRecipientMetadata
    );
});

test('rich: caller contextInfo is merged in and the bot fields still win', () => {
    const rich = buildRichMessageContent({
        contextInfo: { isForwarded: true, forwardOrigin: 99 }
    }).botForwardedMessage.message.richResponseMessage;
    assert.equal(rich.contextInfo.isForwarded, true);
    // Bot fields are set after the spread, so they override anything the caller passed.
    assert.equal(rich.contextInfo.forwardOrigin, 4);
});

// ── sendMessageMembers targeting (onlyMember) ────────────────────────────────

const participants = [
    { id: 'owner@s.whatsapp.net', admin: 'superadmin' },
    { id: 'admin@s.whatsapp.net', admin: 'admin' },
    { id: 'member1@s.whatsapp.net', admin: null },
    { id: 'member2@s.whatsapp.net' },
    { id: 'me@s.whatsapp.net', admin: null }
];
const ME = 'me@s.whatsapp.net';

test('members: onlyMember (default true) selects non-admin members and excludes the sender', () => {
    assert.deepEqual(selectGroupMemberJids(participants, ME), [
        'member1@s.whatsapp.net',
        'member2@s.whatsapp.net'
    ]);
});

test('members: onlyMember=true is explicit and matches the default', () => {
    assert.deepEqual(
        selectGroupMemberJids(participants, ME, { onlyMember: true }),
        selectGroupMemberJids(participants, ME)
    );
});

test('members: onlyMember=false selects every participant except the sender', () => {
    assert.deepEqual(selectGroupMemberJids(participants, ME, { onlyMember: false }), [
        'owner@s.whatsapp.net',
        'admin@s.whatsapp.net',
        'member1@s.whatsapp.net',
        'member2@s.whatsapp.net'
    ]);
});

test('members: an admin-only group still returns no members when onlyMember is on (no silent fallback)', () => {
    const adminsOnly = [
        { id: 'a@s.whatsapp.net', admin: 'admin' },
        { id: 'me@s.whatsapp.net', admin: 'admin' }
    ];
    assert.deepEqual(selectGroupMemberJids(adminsOnly, ME), []);
});

test('members: falls back to lid when id is missing', () => {
    const lidOnly = [{ lid: 'lidA@lid' }, { lid: 'lidB@lid', admin: 'admin' }];
    assert.deepEqual(selectGroupMemberJids(lidOnly, ME, { onlyMember: true }), ['lidA@lid']);
});

test('members: a custom isSameUser decides who is the sender', () => {
    const isSame = (a, b) => a.split('@')[0] === b.split('@')[0];
    const list = [{ id: '111@lid' }, { id: '222@lid' }];
    assert.deepEqual(selectGroupMemberJids(list, '111@s.whatsapp.net', { isSameUser: isSame }), ['222@lid']);
});

test('members: empty or missing participants yields an empty list', () => {
    assert.deepEqual(selectGroupMemberJids([], ME), []);
    assert.deepEqual(selectGroupMemberJids(undefined, ME), []);
});
