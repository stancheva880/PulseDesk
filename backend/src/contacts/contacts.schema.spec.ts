import { ContactRelationship } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ContactPersonSchema, ContactRelationshipSchema } from './contacts.schema';

const runtimeContact = {
  id: 'cp1',
  tenantId: 't1',
  traineeId: 'tr1',
  firstName: 'Maria',
  lastName: 'Petrova',
  relationship: ContactRelationship.GUARDIAN,
  phone: '+359888000111',
  email: 'maria@test.local',
  isPrimary: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-01T09:00:00.000Z'),
};

describe('ContactRelationshipSchema', () => {
  it('builds ContactRelationship from the Prisma enum and rejects an unknown member', () => {
    expect(ContactRelationshipSchema.options).toEqual(Object.values(ContactRelationship));
    expect(ContactRelationshipSchema.parse('GRANDPARENT')).toBe('GRANDPARENT');
    expect(ContactRelationshipSchema.safeParse('STEPPARENT').success).toBe(false);
  });
});

describe('ContactPersonSchema', () => {
  it('transforms the audit timestamps to ISO strings', () => {
    const contact = ContactPersonSchema.parse(runtimeContact);
    expect(contact.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(contact.updatedAt).toBe('2026-08-01T09:00:00.000Z');
  });

  it('allows phone and email to be null', () => {
    const contact = ContactPersonSchema.parse({
      ...runtimeContact,
      phone: null,
      email: null,
    });
    expect(contact.phone).toBeNull();
    expect(contact.email).toBeNull();
  });

  it('rejects a contact that lost its relationship', () => {
    const { relationship: _dropped, ...withoutRelationship } = runtimeContact;
    expect(ContactPersonSchema.safeParse(withoutRelationship).success).toBe(false);
  });
});
