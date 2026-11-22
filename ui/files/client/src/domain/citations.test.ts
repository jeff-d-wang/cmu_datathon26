import { describe, expect, it } from 'vitest';
import { canonicalSpecialties, channelsFor, items, pipelinePhrases, quotesFor, serviceTerms, sourceDomains, type FacilityRecord } from './citations';

const rec: FacilityRecord = {
  description: 'Mars Specialty Clinic is a General Surgery Clinic in Patna. Some of the services provided are Obstetrician and treatment for IBS.',
  specialties: '["generalSurgery","gynecologyAndObstetrics"]',
  procedures: '["Offers obstetric care services","Provides treatment for IBS (stomach disorders)","Manages pneumonia"]',
  equipment: '[]',
  capability: '["Multi-speciality clinic","Has 4 doctors on staff"]',
  source_urls: '["https://www.practo.com/patna/clinic/mars","https://www.lybrate.com/patna/clinic/mars",null]',
  specialties_canon: 'gynecologyAndObstetrics|nephrology',
  matched_phrases: '{"gynecologyAndObstetrics":["procedure~Offers obstetric care services","capability~Centre of excellence for Maternity","bogus~x"]}',
  channels: 'gynecologyAndObstetrics:capability,description,procedure,specialty_claim|generalSurgery:capability',
};

describe('citations', () => {
  it('parses JSON-array fields and drops nulls', () => {
    expect(items(rec.source_urls)).toHaveLength(2);
    expect(items('[]')).toEqual([]);
  });
  it('builds stems from key and name', () => {
    expect(serviceTerms('gynecologyAndObstetrics', 'Gynaecology and obstetrics')).toEqual(expect.arrayContaining(['obstetri', 'obstetric']));
  });
  it('quotes the record text that mentions the service, procedures first', () => {
    const q = quotesFor(rec, 'gynecologyAndObstetrics', 'Gynaecology and obstetrics');
    expect(q[0]).toEqual({ text: 'Offers obstetric care services', field: 'procedures' });
    expect(q.map((x) => x.field)).toContain('description');
  });
  it('returns nothing when the record never mentions the service', () => {
    expect(quotesFor(rec, 'dialysis', 'Dialysis')).toEqual([]);
  });
  it('lists evidence channels in plain words', () => {
    expect(channelsFor(rec, 'gynecologyAndObstetrics')).toEqual(['capabilities list', 'description', 'procedures list', 'specialty list']);
    expect(channelsFor(rec, 'dialysis')).toEqual([]);
  });
  it('gives source domains as text', () => {
    expect(sourceDomains(rec)).toEqual(['practo.com', 'lybrate.com']);
  });
});

describe('pipelinePhrases', () => {
  it('parses phrases', () => {
    expect(pipelinePhrases(rec, 'gynecologyAndObstetrics')).toEqual([
      { text: 'Offers obstetric care services', field: 'procedures' },
      { text: 'Centre of excellence for Maternity', field: 'capability' },
    ]);
  });
  it('returns [] for bad JSON', () => {
    expect(pipelinePhrases({ ...rec, matched_phrases: '{nope' }, 'gynecologyAndObstetrics')).toEqual([]);
  });
  it('returns [] for unknown key', () => {
    expect(pipelinePhrases(rec, 'dialysis')).toEqual([]);
  });
});

describe('canonicalSpecialties', () => {
  it('splits on | and drops empties', () => {
    expect(canonicalSpecialties(rec)).toEqual(['gynecologyAndObstetrics', 'nephrology']);
    expect(canonicalSpecialties({ ...rec, specialties_canon: '' })).toEqual([]);
  });
});
