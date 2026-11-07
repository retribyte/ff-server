// Lines up an episode's stored messages with a re-import of it, so what hangs
// off a message (commentary notes, persona stamps) follows it to its new
// number. Pure, so it can be unit-tested without a database.

/** Above this many cells (old x new, after trimming the common ends) the exact-match pass is skipped. */
const MAX_LCS_CELLS = 10_000_000;

/**
 * For each new message, the index of the old message it takes over from, or
 * null for an added one. Identical messages match in order (a longest common
 * subsequence of the keys); between two matches, the leftover old and new
 * messages pair up in order as edits, and any surplus is added or removed.
 */
export function alignMessages(oldKeys: string[], newKeys: string[]): (number | null)[] {
    const n = oldKeys.length;
    const m = newKeys.length;
    let pre = 0;
    while (pre < n && pre < m && oldKeys[pre] === newKeys[pre]) pre++;
    let suf = 0;
    while (suf < n - pre && suf < m - pre && oldKeys[n - 1 - suf] === newKeys[m - 1 - suf]) suf++;

    // exact matches as [old, new] pairs, in order
    const anchors: [number, number][] = [];
    for (let i = 0; i < pre; i++) anchors.push([i, i]);
    for (const [i, j] of lcs(oldKeys.slice(pre, n - suf), newKeys.slice(pre, m - suf))) anchors.push([pre + i, pre + j]);
    for (let k = suf; k > 0; k--) anchors.push([n - k, m - k]);

    const out: (number | null)[] = new Array(m).fill(null);
    let oi = 0;
    let nj = 0;
    for (const [ai, aj] of [...anchors, [n, m] as [number, number]]) {
        // the gap before this anchor: pair in order, the rest is added/removed
        for (let k = 0; k < Math.min(ai - oi, aj - nj); k++) out[nj + k] = oi + k;
        if (aj < m) out[aj] = ai;
        oi = ai + 1;
        nj = aj + 1;
    }
    return out;
}

/** Matched index pairs of a longest common subsequence of a and b. */
function lcs(a: string[], b: string[]): [number, number][] {
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_LCS_CELLS) return [];
    // len[i][j] = LCS length of a[i..] and b[j..]
    const w = m + 1;
    const len = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            len[i * w + j] = a[i] === b[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) pairs.push([i++, j++]);
        else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
        else j++;
    }
    return pairs;
}

/**
 * For each old message, the new message its notes go to: the one it was
 * aligned with, else (it was removed) the nearest earlier kept message, else
 * the nearest later one. `moved[k]` is true when old message k was removed.
 */
export function noteTargets(alignment: (number | null)[], oldCount: number): { target: number[]; moved: boolean[] } {
    const direct: (number | null)[] = new Array(oldCount).fill(null);
    alignment.forEach((o, j) => {
        if (o !== null) direct[o] = j;
    });
    const target: number[] = new Array(oldCount).fill(0);
    const moved = direct.map((d) => d === null);
    let last: number | null = null;
    for (let k = 0; k < oldCount; k++) {
        if (direct[k] !== null) last = direct[k];
        target[k] = direct[k] ?? last ?? -1;
    }
    let next: number | null = null;
    for (let k = oldCount - 1; k >= 0; k--) {
        if (direct[k] !== null) next = direct[k];
        if (target[k] === -1) target[k] = next ?? 0;
    }
    return { target, moved };
}

/** How a re-import changes the messages: same text, edited in place, added, removed. */
export function alignStats(alignment: (number | null)[], oldKeys: string[], newKeys: string[]) {
    let unchanged = 0;
    let edited = 0;
    let added = 0;
    alignment.forEach((o, j) => {
        if (o === null) added++;
        else if (oldKeys[o] === newKeys[j]) unchanged++;
        else edited++;
    });
    return { unchanged, edited, added, removed: oldKeys.length - unchanged - edited };
}
