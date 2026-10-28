function parseManaCostDetailed(manaCostStr) {
    if (!manaCostStr || typeof manaCostStr !== 'string' || manaCostStr.trim().toLowerCase() === 'no cost') {
        return { cmc: 0, generic: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrids: [], colors: [] };
    }
    let raw = manaCostStr.trim();
    if (!raw.includes('{')) {
        raw = raw.split(/\s+/).filter(Boolean).map(t => `{${t}}`).join('');
    }
    const matches = raw.match(/\{([^}]+)\}/g) || [];
    let generic = 0;
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const hybrids = [];
    const colorSet = new Set();
    let cmc = 0;

    for (const m of matches) {
        const inner = m.replace(/[{}]/g, '').trim().toUpperCase();
        if (/^\d+$/.test(inner)) {
            const num = parseInt(inner, 10);
            generic += num;
            cmc += num;
        } else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(inner)) {
            pips[inner] = (pips[inner] || 0) + 1;
            cmc += 1;
            if (inner !== 'C') colorSet.add(inner);
        } else if (inner.includes('/')) {
            const parts = inner.split('/');
            cmc += 1;
            if (parts.includes('P')) {
                const col = parts.find(p => ['W', 'U', 'B', 'R', 'G'].includes(p));
                if (col) {
                    hybrids.push({ options: [col], isPhyrexian: true });
                    colorSet.add(col);
                }
            } else {
                const validCols = parts.filter(p => ['W', 'U', 'B', 'R', 'G', 'C'].includes(p));
                if (validCols.length > 0) {
                    hybrids.push({ options: validCols, isPhyrexian: false });
                    validCols.forEach(c => { if (c !== 'C') colorSet.add(c); });
                }
            }
        }
    }
    return { cmc, generic, pips, hybrids, colors: Array.from(colorSet), raw };
}

function canPayManaCost(cardOrCost, manaPool, genericReduction = 0, extraGenericTax = 0) {
    const costStr = typeof cardOrCost === 'string' ? cardOrCost : (cardOrCost && cardOrCost.manaCost ? cardOrCost.manaCost : '');
    const isLand = cardOrCost && typeof cardOrCost === 'object' && Boolean(cardOrCost.isLand);
    if (isLand || !costStr) return { canPay: true, missing: [], reason: '' };

    const parsed = parseManaCostDetailed(costStr);
    const pool = {
        W: (manaPool && manaPool.W) || 0,
        U: (manaPool && manaPool.U) || 0,
        B: (manaPool && manaPool.B) || 0,
        R: (manaPool && manaPool.R) || 0,
        G: (manaPool && manaPool.G) || 0,
        C: (manaPool && manaPool.C) || 0
    };
    const missing = [];

    // 1. Specific colored pips
    const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
    for (const col of COLORS) {
        const req = (parsed.pips && parsed.pips[col]) || 0;
        if (req > 0) {
            if (pool[col] < req) {
                missing.push(`${req - pool[col]} {${col}}`);
                pool[col] = 0;
            } else {
                pool[col] -= req;
            }
        }
    }

    // 2. Hybrids
    if (Array.isArray(parsed.hybrids)) {
        for (const h of parsed.hybrids) {
            const opts = h.options || [];
            const foundCol = opts.find(c => pool[c] > 0);
            if (foundCol) {
                pool[foundCol]--;
            } else if (!h.isPhyrexian) {
                missing.push(`1 {${opts.join('/')}}`);
            }
        }
    }

    // 3. Generic mana
    const genericNeeded = Math.max(0, (parsed.generic || 0) + extraGenericTax - genericReduction);
    const remainingPoolTotal = COLORS.reduce((sum, col) => sum + pool[col], 0);

    if (remainingPoolTotal < genericNeeded) {
        missing.push(`${genericNeeded - remainingPoolTotal} generic mana`);
    }

    if (missing.length > 0) {
        return { canPay: false, missing, reason: `Need ${missing.join(', ')} (pool: W:${manaPool.W||0} U:${manaPool.U||0} B:${manaPool.B||0} R:${manaPool.R||0} G:${manaPool.G||0} C:${manaPool.C||0})` };
    }
    return { canPay: true, missing: [], reason: '' };
}

function deductDetailedMana(cardOrCost, manaPool, battlefield = [], genericReduction = 0, extraGenericTax = 0) {
    if (!manaPool) return;
    const costStr = typeof cardOrCost === 'string' ? cardOrCost : (cardOrCost && cardOrCost.manaCost ? cardOrCost.manaCost : '');
    const isLand = cardOrCost && typeof cardOrCost === 'object' && Boolean(cardOrCost.isLand);
    if (isLand) return;

    // Numeric cost fallback
    if (typeof cardOrCost === 'number' || (/^\d+$/.test(String(costStr).trim()))) {
        let remaining = typeof cardOrCost === 'number' ? cardOrCost : parseInt(costStr, 10);
        remaining = Math.max(0, remaining + extraGenericTax - genericReduction);
        const order = ['C', 'W', 'G', 'R', 'U', 'B'];
        for (const col of order) {
            if (manaPool[col] > 0 && remaining > 0) {
                const spend = Math.min(manaPool[col], remaining);
                manaPool[col] -= spend;
                remaining -= spend;
                consumeBattlefieldPips(battlefield, col, spend);
            }
        }
        return;
    }

    const parsed = parseManaCostDetailed(costStr);
    const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];

    // 1. Deduct exact colored pips
    for (const col of COLORS) {
        const req = (parsed.pips && parsed.pips[col]) || 0;
        if (req > 0 && manaPool[col] > 0) {
            const spend = Math.min(manaPool[col], req);
            manaPool[col] -= spend;
            consumeBattlefieldPips(battlefield, col, spend);
        }
    }

    // 2. Deduct hybrids
    if (Array.isArray(parsed.hybrids)) {
        for (const h of parsed.hybrids) {
            const opts = h.options || [];
            const foundCol = opts.find(c => manaPool[c] > 0);
            if (foundCol) {
                manaPool[foundCol]--;
                consumeBattlefieldPips(battlefield, foundCol, 1);
            }
        }
    }

    // 3. Deduct generic mana (generic reduction applied)
    let genericNeeded = Math.max(0, (parsed.generic || 0) + extraGenericTax - genericReduction);
    const genericOrder = ['C', 'W', 'G', 'R', 'U', 'B'];
    for (const col of genericOrder) {
        if (genericNeeded <= 0) break;
        if (manaPool[col] > 0) {
            const spend = Math.min(manaPool[col], genericNeeded);
            manaPool[col] -= spend;
            genericNeeded -= spend;
            consumeBattlefieldPips(battlefield, col, spend);
        }
    }
}

function consumeBattlefieldPips(battlefield, color, count) {
    if (!Array.isArray(battlefield) || count <= 0) return;
    let toConsume = count;
    for (const perm of battlefield) {
        if (toConsume <= 0) break;
        if (perm && Array.isArray(perm.producedMana) && perm.producedMana.length > 0) {
            for (let i = perm.producedMana.length - 1; i >= 0 && toConsume > 0; i--) {
                if (perm.producedMana[i] === color) {
                    perm.producedMana.splice(i, 1);
                    toConsume--;
                }
            }
            if (perm.producedMana.length === 0) {
                perm.producedMana = null;
            }
        }
    }
}

// User test scenario: Tapped Island (U:1) and Swamp (B:1)
const pool = { W: 0, U: 1, B: 1, R: 0, G: 0, C: 0 };
console.log('Testing User Requirements: [Pool = 1 Blue, 1 Black]');
console.log('1. Blue spell {U}:', canPayManaCost('{U}', pool).canPay ? 'PASS' : 'FAIL');
console.log('2. Black spell {B}:', canPayManaCost('{B}', pool).canPay ? 'PASS' : 'FAIL');
console.log('3. Dimir spell {U}{B}:', canPayManaCost('{U}{B}', pool).canPay ? 'PASS' : 'FAIL');
console.log('4. Colorless/Generic spell {2}:', canPayManaCost('{2}', pool).canPay ? 'PASS' : 'FAIL');
console.log('5. Red spell {R} (MUST FAIL):', !canPayManaCost('{R}', pool).canPay ? 'PASS' : 'FAIL');
console.log('6. Green spell {1}{G} (MUST FAIL):', !canPayManaCost('{1}{G}', pool).canPay ? 'PASS' : 'FAIL');
console.log('7. White spell {W} (MUST FAIL):', !canPayManaCost('{W}', pool).canPay ? 'PASS' : 'FAIL');
console.log('8. Gruul spell {R}{G} (MUST FAIL):', !canPayManaCost('{R}{G}', pool).canPay ? 'PASS' : 'FAIL');
console.log('9. Dimir 3-mana {1}{U}{B} (MUST FAIL - only 2 mana in pool):', !canPayManaCost('{1}{U}{B}', pool).canPay ? 'PASS' : 'FAIL');

// Test deduction
const testPool = { W: 0, U: 1, B: 1, R: 0, G: 0, C: 0 };
const battlefield = [
    { name: 'Island', producedMana: ['U'] },
    { name: 'Swamp', producedMana: ['B'] }
];
deductDetailedMana('{U}{B}', testPool, battlefield);
console.log('10. After paying {U}{B}: pool is empty:', testPool.U === 0 && testPool.B === 0 ? 'PASS' : 'FAIL');
console.log('11. ProducedMana consumed on lands:', battlefield.every(l => l.producedMana === null) ? 'PASS' : 'FAIL');
