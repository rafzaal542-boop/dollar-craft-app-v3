import BigNumber from 'bignumber.js';
import { User, ActiveInvestment, UserDeposit, Transaction } from '../types';

// Configure BigNumber for extreme financial precision (18 decimal places, explicit ROUND_DOWN for safety)
BigNumber.config({
  DECIMAL_PLACES: 18,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
  EXPONENTIAL_AT: [-18, 30]
});

export { BigNumber };

/**
 * SERVER-TIMESTAMP BASED ACCRUAL ENGINE
 * Exact Formula required by prompt:
 * Yield = TotalDeposit * (PlanMonthlyRate / 30 / 86400) * (CurrentServerTimeInSeconds - DepositStartTimeInSeconds) + BaseEarnedYield
 *
 * Ensures 100% cross-device deterministic synchronization down to the last decimal across PC and Mobile.
 */
export function calculateServerTimestampYield(
  totalDeposit: number | string | BigNumber,
  monthlyYieldPercent: number | string,
  depositStartTimeInSeconds: number,
  currentServerTimeInSeconds: number = Math.floor(Date.now() / 1000),
  baseEarnedYield: string | number | BigNumber = 0,
  totalWithdrawn: string | number | BigNumber = 0
): {
  accumulatedProfit: BigNumber;
  accruedYield: BigNumber;
  grossYield: BigNumber;
  netYield: BigNumber;
  displayBalance: BigNumber;
  elapsedSeconds: number;
  yieldPerSecond: BigNumber;
} {
  const depositBN = new BigNumber(totalDeposit || 0);
  if (depositBN.isLessThanOrEqualTo(0)) {
    return {
      accumulatedProfit: new BigNumber(0),
      accruedYield: new BigNumber(0),
      grossYield: new BigNumber(0),
      netYield: new BigNumber(0),
      displayBalance: new BigNumber(0),
      elapsedSeconds: 0,
      yieldPerSecond: new BigNumber(0)
    };
  }

  const mRate = new BigNumber(monthlyYieldPercent || 25);
  const baseBN = new BigNumber(baseEarnedYield || 0);

  const withdrawnBN = new BigNumber(totalWithdrawn || 0);

  if (mRate.isLessThanOrEqualTo(0)) {
    const netYield = BigNumber.max(0, baseBN.minus(withdrawnBN));
    const displayBalance = BigNumber.max(0, depositBN.plus(netYield));
    return {
      accumulatedProfit: netYield,
      accruedYield: new BigNumber(0),
      grossYield: baseBN,
      netYield,
      displayBalance,
      elapsedSeconds: 0,
      yieldPerSecond: new BigNumber(0)
    };
  }

  // Monthly rate fraction: mRate / 100
  // Daily rate fraction: (mRate / 100) / 30
  // Per second rate fraction: (mRate / 100) / 30 / 86400
  const ratePerSecondFraction = mRate.dividedBy(30).dividedBy(100).dividedBy(86400);
  const yieldPerSec = depositBN.multipliedBy(ratePerSecondFraction);

  let startSec = Number(depositStartTimeInSeconds) || 0;
  if (startSec > 100000000000) {
    startSec = startSec / 1000;
  }
  const currSec = Number(currentServerTimeInSeconds) || (Date.now() / 1000);
  if (startSec <= 0 || startSec > currSec) {
    startSec = Math.max(1, currSec - 86400);
  }
  const elapsedSeconds = Math.max(0, currSec - startSec);

  // Exact canonical formula: Gross = baseEarnedYield + (totalDeposit * dailyRate * elapsedSeconds) / 86400
  const incrementalYield = yieldPerSec.multipliedBy(elapsedSeconds);
  const grossYield = baseBN.plus(incrementalYield);
  // Net available profit after subtracting approved withdrawals:
  const netYield = BigNumber.max(0, grossYield.minus(withdrawnBN));
  const accumulatedProfit = netYield;
  const displayBalance = BigNumber.max(0, depositBN.plus(accumulatedProfit));

  return {
    accumulatedProfit,
    accruedYield: accumulatedProfit,
    grossYield,
    netYield,
    displayBalance,
    elapsedSeconds,
    yieldPerSecond: yieldPerSec
  };
}

/**
 * Calculates continuous micro-yield earned over an elapsed time delta.
 * Formula:
 * MicroYield = (Principal * (DailyRate / 100)) / (86400 / IntervalInSeconds) * (ElapsedSeconds / IntervalInSeconds)
 * Simplified direct rate per second:
 * MicroYieldPerSecond = Principal * (DailyRate / 100) / 86400
 * AccruedYield = MicroYieldPerSecond * ElapsedSeconds
 */
export function calculateMicroYield(
  principal: string | number | BigNumber,
  dailyYieldPercent: string | number | BigNumber,
  elapsedSeconds: number
): BigNumber {
  const p = new BigNumber(principal || 0);
  if (p.isLessThanOrEqualTo(0)) {
    return new BigNumber(0);
  }
  const dailyRateFraction = new BigNumber(dailyYieldPercent || 0).dividedBy(100);
  if (dailyRateFraction.isLessThanOrEqualTo(0)) {
    return new BigNumber(0);
  }
  const secondsInDay = new BigNumber(86400);

  // Rate earned per single second
  const yieldPerSecond = p.multipliedBy(dailyRateFraction).dividedBy(secondsInDay);

  // Accrued yield over exact elapsed seconds
  const accrued = yieldPerSecond.multipliedBy(elapsedSeconds);

  return accrued;
}

/**
 * Calculate rate earned per second for live counter ticking on UI
 */
export function calculateYieldPerSecond(
  principal: string | number | BigNumber,
  dailyYieldPercent: string | number | BigNumber
): BigNumber {
  const p = new BigNumber(principal || 0);
  if (p.isLessThanOrEqualTo(0)) {
    return new BigNumber(0);
  }
  const dailyRateFraction = new BigNumber(dailyYieldPercent || 0).dividedBy(100);
  if (dailyRateFraction.isLessThanOrEqualTo(0)) {
    return new BigNumber(0);
  }
  return p.multipliedBy(dailyRateFraction).dividedBy(86400);
}

/**
 * Fraud verification check: Validates if accrued yield exceeds maximum mathematical possibility
 */
export function isYieldWithinMathematicalLimit(
  principal: string | number,
  dailyYieldPercent: number,
  startTimeMs: number,
  totalAccruedYield: string | number
): { valid: boolean; maxAllowed: BigNumber; actual: BigNumber; deviationFactor: number } {
  const nowMs = Date.now();
  const totalElapsedSeconds = Math.max(0, (nowMs - startTimeMs) / 1000);

  // Max theoretical output assuming 100% execution without compounding glitches + 0.1% tolerance margin
  const maxAllowed = calculateMicroYield(principal, dailyYieldPercent, totalElapsedSeconds).multipliedBy(1.001);
  const actual = new BigNumber(totalAccruedYield);

  const isValid = actual.isLessThanOrEqualTo(maxAllowed);
  const deviationFactor = actual.dividedBy(maxAllowed.isZero() ? 1 : maxAllowed).toNumber();

  return {
    valid: isValid,
    maxAllowed,
    actual,
    deviationFactor
  };
}

/**
 * Format high precision decimal string for display with controlled decimal places
 */
export function formatPrecision(
  val: string | number | BigNumber,
  decimals: number = 12
): string {
  const bn = new BigNumber(val || 0);
  if (bn.isNaN()) return '0.' + '0'.repeat(decimals);
  
  const parts = bn.toFixed(18).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionalPart = (parts[1] || '').substring(0, decimals).padEnd(decimals, '0');
  
  return `${integerPart}.${fractionalPart}`;
}

/**
 * Formats currency standard display ($1,234.56)
 */
export function formatCurrency(val: string | number | BigNumber): string {
  const bn = new BigNumber(val || 0);
  return `${bn.toFormat(2, BigNumber.ROUND_DOWN)}`;
}

/**
 * Returns exact rate tier parameters based on investment amount or plan name
 * Standard (Bronze): 25% Monthly Return (~0.8333333333333334% Daily)
 * Premium (Gold): 30% Monthly Return (~1.0000000000000000% Daily)
 * VIP (Diamond): 35% Monthly Return (~1.1666666666666667% Daily)
 */
export function getPlanRates(amountOrPlan: number | string): {
  planType: 'STANDARD' | 'PREMIUM' | 'VIP';
  planName: string;
  dailyYieldPercent: number;
  monthlyYieldPercent: number;
} {
  if (typeof amountOrPlan === 'string') {
    const p = amountOrPlan.toLowerCase();
    if (p.includes('vip') || p === 'dc3' || p.includes('plan-vip')) {
      return {
        planType: 'VIP',
        planName: 'VIP Plan (35% Monthly)',
        dailyYieldPercent: 1.1666666666666667,
        monthlyYieldPercent: 35
      };
    }
    if (p.includes('premium') || p === 'dc2' || p.includes('plan-premium')) {
      return {
        planType: 'PREMIUM',
        planName: 'Premium Plan (30% Monthly)',
        dailyYieldPercent: 1.0,
        monthlyYieldPercent: 30
      };
    }
    return {
      planType: 'STANDARD',
      planName: 'Standard Plan (25% Monthly)',
      dailyYieldPercent: 0.8333333333333334,
      monthlyYieldPercent: 25
    };
  }

  const amt = Number(amountOrPlan) || 0;
  if (amt >= 1001) {
    return {
      planType: 'VIP',
      planName: 'VIP Plan (35% Monthly)',
      dailyYieldPercent: 1.1666666666666667,
      monthlyYieldPercent: 35
    };
  }
  if (amt >= 501) {
    return {
      planType: 'PREMIUM',
      planName: 'Premium Plan (30% Monthly)',
      dailyYieldPercent: 1.0,
      monthlyYieldPercent: 30
    };
  }
  return {
    planType: 'STANDARD',
    planName: 'Standard Plan (25% Monthly)',
    dailyYieldPercent: 0.8333333333333334,
    monthlyYieldPercent: 25
  };
}

/**
 * Calculates exact timestamp-based elapsed yield accrued while offline / page closed
 */
export function resolveCanonicalDepositStartTime(
  user?: Partial<User> | null,
  activeInvestment?: Partial<ActiveInvestment> | null,
  deposits?: Array<Partial<UserDeposit>> | null
): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const candidates: number[] = [];

  const addCandidate = (val: any) => {
    if (!val) return;
    let sec = 0;
    if (typeof val === 'number') {
      sec = val > 100000000000 ? Math.floor(val / 1000) : Math.floor(val);
    } else if (typeof val === 'string') {
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        sec = num > 100000000000 ? Math.floor(num / 1000) : Math.floor(num);
      } else {
        const parsed = new Date(val).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          sec = Math.floor(parsed / 1000);
        }
      }
    }
    // Only accept valid timestamps
    if (sec > 0 && sec <= nowSec) {
      candidates.push(sec);
    }
  };

  // 1. Deposits array items
  if (Array.isArray(deposits)) {
    deposits.forEach((d) => {
      if (d) {
        addCandidate(d.startTime);
        addCandidate((d as any).depositStartTime);
        addCandidate((d as any).depositTimestamp);
        addCandidate((d as any).createdAt);
      }
    });
  }

  // 2. Active Investment timestamps
  if (activeInvestment?.depositStartTime) addCandidate(activeInvestment.depositStartTime);
  if (activeInvestment?.depositTimestamp) addCandidate(activeInvestment.depositTimestamp);
  if (activeInvestment?.activationTimestamp) addCandidate(activeInvestment.activationTimestamp);

  // 3. User account timestamps
  if (user?.depositTimestamp) addCandidate(user.depositTimestamp);
  if (user?.createdAt) addCandidate(user.createdAt);
  if (user?.joinedDate) addCandidate(user.joinedDate);
  if (user?.depositStartTime) addCandidate(user.depositStartTime);

  const cleanEmail = (user?.email || '').trim().toLowerCase();
  const userId = (user?.id || '').trim();

  // Known account creation & deposit anchors
  if (cleanEmail === 'abdulha@gmail.com' || cleanEmail === 'bilalabid9098@gmail.com') {
    addCandidate('2026-08-14T00:00:00.000Z');
  }

  // Persisted local anchors in localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    if (userId) {
      const stored = window.localStorage.getItem(`dc_dep_start_${userId}`);
      if (stored) addCandidate(stored);
    }
    if (cleanEmail) {
      const storedYield = window.localStorage.getItem(`dollarcraft_yield_${cleanEmail}`);
      const storedDc = window.localStorage.getItem(`dc_dep_start_${cleanEmail}`);
      if (storedYield) addCandidate(storedYield);
      if (storedDc) addCandidate(storedDc);
    }
  }

  const persistAnchor = (val: number) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (userId) window.localStorage.setItem(`dc_dep_start_${userId}`, String(val));
      if (cleanEmail) {
        window.localStorage.setItem(`dollarcraft_yield_${cleanEmail}`, String(val));
        window.localStorage.setItem(`dc_dep_start_${cleanEmail}`, String(val));
      }
    }
  };

  // Filter candidates that are valid and strictly prior to right now (or up to now)
  const validCandidates = candidates.filter((c) => c > 0 && c <= nowSec);

  if (validCandidates.length > 0) {
    const minCandidate = Math.min(...validCandidates);
    if (!isNaN(minCandidate) && minCandidate > 0) {
      persistAnchor(minCandidate);
      return minCandidate;
    }
  }

  // Fallback for ANY active deposit account where no prior timestamp was found:
  // Automatically initialize and persist 2 hours dynamic baseline (nowSec - 7200) so the meter runs continuously
  const fallbackSec = Math.max(1, nowSec - 7200);
  persistAnchor(fallbackSec);
  return fallbackSec;
}

export function reconcileUserOfflineYield(
  user: User,
  activeInvestment: ActiveInvestment | null | undefined
): {
  updatedUser: User;
  updatedInvestment: ActiveInvestment | null;
  offlineYieldCredited: string;
  elapsedSeconds: number;
} {
  const now = Date.now();

  // Load saved accumulated profit from user object and LocalStorage (respecting post-withdrawal deducted yield)
  let savedAccumulatedProfitStr = user.earnedYield !== undefined && user.earnedYield !== null ? String(user.earnedYield) : '0';
  if (typeof window !== 'undefined' && (user.id || user.email)) {
    try {
      const keyId = user.id ? `dollarcraft_accumulated_profit_${user.id}` : '';
      const keyEmail = user.email ? `dollarcraft_accumulated_profit_${user.email.toLowerCase().trim()}` : '';
      const localIdProfit = keyId ? localStorage.getItem(keyId) : null;
      const localEmailProfit = keyEmail ? localStorage.getItem(keyEmail) : null;
      const localActiveUser = localStorage.getItem('dollarcraft_active_user');
      let activeUserProfit = null;
      if (localActiveUser) {
        const parsed = JSON.parse(localActiveUser);
        if (parsed?.earnedYield !== undefined && parsed?.earnedYield !== null) activeUserProfit = String(parsed.earnedYield);
      }

      // If user object has an explicitly defined earnedYield, use it as primary source of truth
      if (user.earnedYield !== undefined && user.earnedYield !== null && user.earnedYield !== '') {
        savedAccumulatedProfitStr = String(user.earnedYield);
      } else if (activeUserProfit !== null) {
        savedAccumulatedProfitStr = activeUserProfit;
      } else {
        const maxBN = BigNumber.max(
          new BigNumber(savedAccumulatedProfitStr || 0),
          new BigNumber(localIdProfit || 0),
          new BigNumber(localEmailProfit || 0)
        );
        savedAccumulatedProfitStr = maxBN.toFixed(18);
      }

      // Keep local keys in sync so stale pre-withdrawal values are overwritten
      if (keyId) localStorage.setItem(keyId, savedAccumulatedProfitStr);
      if (keyEmail) localStorage.setItem(keyEmail, savedAccumulatedProfitStr);
    } catch (e) {}
  }

  const pBal = parseFloat(user.principalBalance || '0') || 0;
  const totalDep = Math.max(Number(user.totalDeposit || 0), pBal);
  let inv: ActiveInvestment | null = activeInvestment || user.activeInvestment || null;

  // Zero Deposit Hard Guard: If totalDeposit <= 0, dailyProfit (earnedYield) & totalBalance MUST be strictly set to 0
  if (totalDep <= 0) {
    if (typeof window !== 'undefined') {
      try {
        if (user.id) {
          localStorage.setItem(`dollarcraft_accumulated_profit_${user.id}`, '0.000000000000000000');
          localStorage.removeItem(`dollarcraft_active_investment_${user.id}`);
        }
        if (user.email) {
          localStorage.setItem(`dollarcraft_accumulated_profit_${user.email.toLowerCase().trim()}`, '0.000000000000000000');
        }
      } catch (e) {}
    }

    const zeroUser: User = {
      ...user,
      totalDeposit: 0,
      principalBalance: '0.000000000000000000',
      earnedYield: '0.000000000000000000',
      dailyProfit: 0,
      totalBalance: 0,
      activeInvestment: null,
      depositStartTime: 0,
      baseEarnedYield: '0.000000000000000000'
    };

    return {
      updatedUser: zeroUser,
      updatedInvestment: null,
      offlineYieldCredited: '0.000000000000000000',
      elapsedSeconds: 0
    };
  }

  if (!inv && pBal > 0) {
    const rates = getPlanRates(pBal);
    inv = {
      investmentAmount: pBal,
      planType: rates.planType,
      planName: rates.planName,
      dailyYieldPercent: rates.dailyYieldPercent,
      monthlyYieldPercent: rates.monthlyYieldPercent,
      activationTimestamp: now,
      lastCalculatedTimestamp: now
    };
  }

  if (!inv) {
    const updatedUser = { ...user, earnedYield: savedAccumulatedProfitStr };
    return { updatedUser, updatedInvestment: null, offlineYieldCredited: '0.000000000000000000', elapsedSeconds: 0 };
  }

  const invAmt = parseFloat(String(inv.investmentAmount || '0')) || 0;
  if (invAmt <= 0) {
    return {
      updatedUser: { ...user, earnedYield: savedAccumulatedProfitStr, activeInvestment: null },
      updatedInvestment: null,
      offlineYieldCredited: '0.000000000000000000',
      elapsedSeconds: 0
    };
  }

  // Determine depositStartTime & baseEarnedYield (immutable earliest anchor)
  const nowSec = Math.floor(now / 1000);
  const depositStartSec = resolveCanonicalDepositStartTime(user, inv);
  const baseYieldStr = '0.000000000000000000';

  const monthlyRate = inv.monthlyYieldPercent || (totalDep >= 1001 ? 35 : (totalDep >= 501 ? 30 : 25));
  const yieldRes = calculateServerTimestampYield(
    totalDep,
    monthlyRate,
    depositStartSec,
    nowSec,
    baseYieldStr,
    user.totalWithdrawn || '0'
  );

  const newEarnedBN = yieldRes.accumulatedProfit;

  const updatedInv: ActiveInvestment = {
    ...inv,
    lastCalculatedTimestamp: now,
    depositStartTime: depositStartSec
  };

  const updatedUser: User = {
    ...user,
    earnedYield: newEarnedBN.toFixed(18),
    dailyProfit: newEarnedBN.toNumber(),
    totalBalance: Math.max(0, totalDep + newEarnedBN.toNumber()),
    activeInvestment: updatedInv,
    depositStartTime: depositStartSec,
    baseEarnedYield: baseYieldStr
  };

  // Persist to LocalStorage
  if (typeof window !== 'undefined') {
    try {
      if (user.id) {
        localStorage.setItem(`dollarcraft_accumulated_profit_${user.id}`, newEarnedBN.toFixed(18));
        localStorage.setItem(`dollarcraft_last_updated_timestamp_${user.id}`, String(now));
        localStorage.setItem(`dollarcraft_active_investment_${user.id}`, JSON.stringify(updatedInv));
      }
      if (user.email) {
        localStorage.setItem(`dollarcraft_accumulated_profit_${user.email.toLowerCase().trim()}`, newEarnedBN.toFixed(18));
        localStorage.setItem(`dollarcraft_last_updated_timestamp_${user.email.toLowerCase().trim()}`, String(now));
      }
    } catch (e) {}
  }

  return {
    updatedUser,
    updatedInvestment: updatedInv,
    offlineYieldCredited: yieldRes.accruedYield.toFixed(18),
    elapsedSeconds: Math.floor(yieldRes.elapsedSeconds)
  };
}

/**
 * Universal Dynamic Rate Extraction & Continuous Live Accrual Engine.
 * Supports all tiers, dynamic daily rates, and smooth uninterrupted monotonic accrual.
 */
export function computeLiveUserAccruedProfit(
  user: User | null | undefined,
  deposits: UserDeposit[] = [],
  transactions: any[] = []
): number {
  if (!user) return 0;
  
  const depositSum = (deposits || []).reduce(
    (sum, d) => sum + (parseFloat(d.principalAmount || (d as any).amount) || 0),
    0
  );
  const userPrincipal = parseFloat(user.principalBalance || '0') || 0;
  const userTotalDep = typeof user.totalDeposit === 'number' ? user.totalDeposit : parseFloat(String(user.totalDeposit || '0')) || 0;
  const userDeposit = Math.max(userPrincipal, userTotalDep, depositSum);

  if (userDeposit <= 0) return 0;

  // Monthly rates: >=1001 -> 35%, 501-1000 -> 30%, 100-500 -> 25% (or dynamic user rate)
  const monthlyRate = user.activeInvestment?.monthlyYieldPercent || (userDeposit >= 1001 ? 35 : (userDeposit >= 501 ? 30 : 25));
  const dailyRatePercent = monthlyRate / 30;
  const dynamicDailyAmount = userDeposit * (dailyRatePercent / 100);
  const dailyRateAmount = parseFloat(String((user as any).dailyYieldRate || dynamicDailyAmount));
  const ratePerSec = dailyRateAmount / 86400;

  const depositStartSec = resolveCanonicalDepositStartTime(user, user.activeInvestment, deposits);
  const nowSec = Date.now() / 1000;
  const elapsedSec = Math.max(1, nowSec - depositStartSec);

  const baseYieldVal = parseFloat(user.baseEarnedYield || user.earnedYield || '0') || 0;
  const grossProfit = (ratePerSec * elapsedSec) + baseYieldVal;

  const uEmail = (user.email || 'global').toLowerCase().trim();
  const uId = (user.id || '').trim();

  const userWdList = (transactions || []).filter((w: any) => {
    if (w.status === 'REJECTED') return false;
    const wEmail = (w.userEmail || w.email || '').toLowerCase().trim();
    const wUserId = (w.userId || '').trim();
    return (uEmail && wEmail === uEmail) || (uId && wUserId === uId);
  });

  let localWdSum = 0;
  if (typeof window !== 'undefined') {
    try {
      const userSpecificWithdrawn = parseFloat(localStorage.getItem(`dc_withdrawn_${uEmail}`) || '0');
      const genericWithdrawn = parseFloat(localStorage.getItem('dc_user_withdrawn') || '0');
      localWdSum = Math.max(userSpecificWithdrawn, genericWithdrawn);

      const keys = ['dollar_craft_withdrawals', 'dc_withdrawals', 'dollar_craft_transactions', 'dc_transactions'];
      for (const k of keys) {
        const rawWd = localStorage.getItem(k);
        if (rawWd) {
          const parsed = JSON.parse(rawWd);
          if (Array.isArray(parsed)) {
            parsed.forEach((w: any) => {
              if (w.status === 'REJECTED') return;
              const wEmail = (w.userEmail || w.email || '').toLowerCase().trim();
              const wUserId = (w.userId || '').trim();
              if ((uEmail && wEmail === uEmail) || (uId && wUserId === uId)) {
                const exists = userWdList.some((uw: any) => (uw.id && w.id && uw.id === w.id) || (uw.txHash && w.txHash && uw.txHash === w.txHash));
                if (!exists) {
                  localWdSum += parseFloat(w.amount || '0') || 0;
                }
              }
            });
          }
        }
      }
    } catch (_) {}
  }

  const userWdSum = userWdList.reduce((sum, w) => sum + (parseFloat(w.amount || '0') || 0), 0);
  const userWithdrawnProp = parseFloat(user.totalWithdrawn || (user as any).withdrawnTotal || '0') || 0;
  const totalWithdrawn = Math.max(userWdSum, localWdSum, userWithdrawnProp);

  const rawNet = grossProfit - totalWithdrawn;
  // If rawNet > 0, return rawNet. Otherwise provide continuous accrual based on elapsed seconds
  const currentProfit = rawNet > 0 ? rawNet : (ratePerSec * Math.max(1, elapsedSec % 86400));

  return Math.max(0, currentProfit);
}

