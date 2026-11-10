// P936 — the training gate: a VA can't be given or booked calls until their training is complete. One rule for every
// picker (lib/callSlots freeVa and vaSlots, the VA side's sample pick, admin's Give pickers). A VA object carries
// `trained` (false = not finished); a VA without the field counts as trained, so real lists that don't know yet (the
// database pick, until P852 stores training per VA) are unchanged. No imports: it runs under node --test.
export const TRAIN_FIRST = 'Finish training to start taking calls'
export const canTakeCalls = v => !!v && v.trained !== false
