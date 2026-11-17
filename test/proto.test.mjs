// Protobuf check for the updated WAProto schema: field 117 (newsletterAdminProfileMessageV2)
// must round-trip, and its wire tag must be 117 << 3 | 2 = 938 (varint 0xAA 0x07).
// Needs the protobufjs runtime, so it runs as part of `npm test` after `yarn install`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proto } from '../WAProto/index.js';

test('proto: newsletterAdminProfileMessageV2 (field 117) encodes with tag 938', () => {
    const bytes = proto.Message.encode({ newsletterAdminProfileMessageV2: {} }).finish();
    assert.deepEqual([...bytes], [0xaa, 0x07, 0x00]);
});

test('proto: field 117 decodes back into newsletterAdminProfileMessageV2', () => {
    const bytes = proto.Message.encode({ newsletterAdminProfileMessageV2: {} }).finish();
    const decoded = proto.Message.decode(bytes);
    assert.notEqual(decoded.newsletterAdminProfileMessageV2, null);
    assert.equal(decoded.newsletterAdminProfileMessage, null);
});

test('proto: neighbouring field 116 still works and is independent of 117', () => {
    const bytes = proto.Message.encode({ newsletterAdminProfileMessage: {} }).finish();
    const decoded = proto.Message.decode(bytes);
    assert.notEqual(decoded.newsletterAdminProfileMessage, null);
    assert.equal(decoded.newsletterAdminProfileMessageV2, null);
});
