import assert from 'node:assert/strict';
import test from 'node:test';
import { entityEditIsCurrent } from '../src/lib/entity-edit';
import type { Group, Company } from '../src/lib/types';

const group: Group = {
  id: 'group-1',
  companyId: 'vetra',
  name: 'Local group',
  facebookId: '878540877111439',
  category: 'Community',
  notes: 'Original notes',
};

const company: Company = {
  id: 'vetra',
  name: 'VETRA',
  businessTypeId: 'retail',
  logoImageUrl: '',
  ownerName: '',
  sortOrder: 0,
  initials: 'VT',
  color: '#263b4b',
  description: 'Original description',
};

test('a group editor accepts an unchanged entity and rejects concurrent edits or deletion', () => {
  assert.equal(entityEditIsCurrent(group, { ...group }), true);
  assert.equal(entityEditIsCurrent(group, { ...group, notes: 'Edited in another tab' }), false);
  assert.equal(
    entityEditIsCurrent(group, { ...group, deletedAt: new Date().toISOString() }),
    false,
  );
  assert.equal(entityEditIsCurrent(group, undefined), false);
});

test('a company editor rejects concurrent edits without conflating field order', () => {
  assert.equal(
    entityEditIsCurrent(company, {
      sortOrder: company.sortOrder,
      ownerName: company.ownerName,
      businessTypeId: company.businessTypeId,
      logoImageUrl: company.logoImageUrl,
      description: company.description,
      color: company.color,
      initials: company.initials,
      name: company.name,
      id: company.id,
    }),
    true,
  );
  assert.equal(entityEditIsCurrent(company, { ...company, name: 'Renamed elsewhere' }), false);
});

test('a new editor accepts a free ID but rejects an ID created elsewhere', () => {
  assert.equal(entityEditIsCurrent<Group>(null, undefined), true);
  assert.equal(entityEditIsCurrent<Group>(null, group), false);
});
