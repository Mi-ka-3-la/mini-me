/** The prototype's example meeting (docs/reference/prototype.html), used by unit tests. */
export const EXAMPLE_TRANSCRIPT = [
  '[00:02] Client PM: So the plan is to go live with the new invoicing module on the 15th, same as agreed.',
  '[00:20] Dev lead: We can do the 15th if the tax rules for Germany are frozen this week.',
  "[00:41] Client PM: They're basically final. Legal just needs to sign off, it's a formality.",
  '[01:05] Finance: Every customer we migrated last year was happy, so this migration will be fine too.',
  '[01:30] Client PM: And since nobody raised concerns in UAT, we can skip the second test cycle.',
  '[01:52] Dev lead: Only three users did UAT though, all from the UK team.',
  "[02:10] Client PM: Let's just say testing is done and we'll fix anything after go-live.",
].join('\n');

import type { AnalysisOutput } from '../../shared/types';

export const EXAMPLE_OUTPUT: AnalysisOutput = {
  tldr: 'Go-live for the invoicing module is held at the 15th, but it rests on German tax rules being frozen and on a UAT that covered only UK users.',
  topics: [
    {
      topic: 'Go-live date',
      points: [
        'Target stays the 15th.',
        'Dev lead ties the date to German tax rules being frozen this week.',
      ],
      decisions: [],
      actions: [],
      open: ['Who confirms the rules are frozen, and by when?'],
    },
  ],
  flags: [
    {
      id: '',
      type: 'trap',
      title: 'Dependency stated as a formality',
      quote: "Legal just needs to sign off, it's a formality.",
      why: 'The 15th depends on this sign-off.',
      ask: 'When is legal sign-off expected?',
      who: 'Client PM',
    },
    {
      id: '',
      type: 'logic',
      title: 'Silence read as approval',
      quote: 'Since nobody raised concerns in UAT, we can skip the second test cycle.',
      why: 'Three UK users say nothing about German invoices.',
      ask: 'Which scenarios did UAT cover?',
      who: 'Client PM',
    },
  ],
};
