/* A panel's word to the student when it has nothing else to show: the
   Console before any output, the Inspector before the first step, the
   card on the Run side before the first assemble, and the error list.
   One shape for all of them: a title, a sentence, and whatever else the
   case needs (a button, the errors), in the middle of the panel, no wider
   than a paragraph reads well.

   (The MIPS edition put one of the university's characters beside the
   words.  Those assets are not in this edition: their use here has not
   been cleared, so the words stand alone.  `pose` is still accepted, and
   ignored, so a call written for the MIPS panels moves over unchanged.) */

import { h } from './dom.ts';

export interface Notice {
  pose?: string;
  title: string;
  body?: Node | string;
  more?: (Node | null)[];             // after the sentence: a button, the errors
}

export function notice(n: Notice): HTMLElement {
  return h('div', { class: 'notice' },
    h('div', { class: 'say' }, h('h3', {}, n.title), n.body ? h('p', {}, n.body) : null, ...(n.more ?? [])));
}
