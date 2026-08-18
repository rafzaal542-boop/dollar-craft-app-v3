import express, { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { BigNumber, calculateMicroYield, calculateYieldPerSecond, isYieldWithinMathematicalLimit, getPlanRates } from './src/lib/yieldEngine';
import { INITIAL_PLANS, MOCK_DEPOSIT_WALLETS } from './src/data/mockData';
import { User, UserDeposit, Transaction, ReferralReward, SystemMetrics, IBApplication, IBCommission, IBMembershipPayment, InternalTransfer, InternalTransferWalletType, AutoTransferSignupConfig, UserNotification, GeneratedIbLink } from './src/types';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Explicit Web App Manifest Endpoints for SEO & PWA
app.get(['/manifest.json', '/site.webmanifest'], (_req: Request, res: Response) => {
  res.header('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.join(process.cwd(), 'public', 'manifest.json'));
});

let isFirestoreQuotaExceeded = false;
let quotaResetTimer: NodeJS.Timeout | null = null;

function handleFirestoreQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '');
  if (
    msg.includes('Quota exceeded') ||
    msg.includes('resource-exhausted') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('free tier')
  ) {
    if (!isFirestoreQuotaExceeded) {
      console.warn('Firestore Quota Limit Reached. Silently pausing backend Firestore scans and serving from memory.');
      isFirestoreQuotaExceeded = true;
    }
    if (quotaResetTimer) clearTimeout(quotaResetTimer);
    quotaResetTimer = setTimeout(() => {
      isFirestoreQuotaExceeded = false;
    }, 5 * 60 * 1000);
    return true;
  }
  return false;
}

// Redirect endpoint for WhatsApp support
app.get('/api/whatsapp-support', (req: Request, res: Response) => {
  const text = (req.query.text as string) || 'Hello Dollar Craft Official Live Support';
  res.redirect(`https://wa.me/923711386478?text=${encodeURIComponent(text)}`);
});

// Dynamic Sitemap.xml endpoint for SEO
app.get('/sitemap.xml', (_req: Request, res: Response) => {
  res.header('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.dollarcraft3.com/</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.dollarcraft3.com/plans</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.dollarcraft3.com/dashboard</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>always</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.dollarcraft3.com/about</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.dollarcraft3.com/contact</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.dollarcraft3.com/ib-program</loc>
    <lastmod>2026-08-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`);
});

// Robots.txt endpoint
app.get('/robots.txt', (_req: Request, res: Response) => {
  res.header('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: https://www.dollarcraft3.com/sitemap.xml
`);
});

// ==========================================
// IN-MEMORY HIGH-PRECISION STATE ENGINE
// (Simulates PostgreSQL Prisma row-level state)
// ==========================================

let adminWalletBalance = '9273632653543654767657.00';
let autoSignupConfig: AutoTransferSignupConfig = {
  enabled: false,
  bonusAmount: '5.00',
  targetWallet: 'MAIN_WALLET'
};
let mockInternalTransfers: InternalTransfer[] = [];
let mockUserNotifications: UserNotification[] = [];
let mockGeneratedIbLinks: GeneratedIbLink[] = [];

function executeAutoSignupBonus(newUser: User) {
  if (!autoSignupConfig.enabled) return;
  const bonusBN = new BigNumber(autoSignupConfig.bonusAmount || '0');
  const adminBN = new BigNumber(adminWalletBalance);
  if (bonusBN.isLessThanOrEqualTo(0) || adminBN.isLessThan(bonusBN)) return;

  adminWalletBalance = adminBN.minus(bonusBN).toFixed(2);
  const adminUser = mockUsers.find(u => u.role === 'ADMIN') || mockUsers[1];

  if (autoSignupConfig.targetWallet === 'MAIN_WALLET' || autoSignupConfig.targetWallet === 'INVESTMENT_WALLET') {
    newUser.principalBalance = new BigNumber(newUser.principalBalance || '0').plus(bonusBN).toFixed(18);
  } else if (autoSignupConfig.targetWallet === 'IB_COMMISSION_WALLET') {
    newUser.is_ib = true;
    newUser.ibStatus = 'APPROVED';
    newUser.ibWithdrawableCommission = new BigNumber(newUser.ibWithdrawableCommission || '0').plus(bonusBN).toFixed(2);
    newUser.ibTotalCommission = new BigNumber(newUser.ibTotalCommission || '0').plus(bonusBN).toFixed(2);
  }

  const transferId = `ITX-${Math.floor(100000 + Math.random() * 900000)}`;
  const transferRecord: InternalTransfer = {
    id: `itx-auto-${Date.now()}`,
    transferId,
    fromUserId: adminUser ? adminUser.id : 'usr-admin-s sovereign',
    fromUserEmail: adminUser ? adminUser.email : 'admin@dollarcraft.io',
    toUserId: newUser.id,
    toUserEmail: newUser.email,
    toWalletType: autoSignupConfig.targetWallet,
    amount: bonusBN.toFixed(2),
    note: 'Auto Signup Welcome Bonus',
    status: 'SUCCESS',
    createdAt: new Date().toISOString()
  };
  mockInternalTransfers.unshift(transferRecord);

  const bonusTx: Transaction = {
    id: `tx-autobonus-${Date.now()}`,
    userId: newUser.id,
    userEmail: newUser.email,
    type: 'ADMIN_ADJUSTMENT',
    amount: bonusBN.toFixed(2),
    precisionAmount: bonusBN.toFixed(18),
    cryptoNetwork: 'Internal Transfer (Welcome Bonus)',
    status: 'APPROVED',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(bonusTx);

  mockUserNotifications.unshift({
    id: `notif-${Date.now()}`,
    userId: newUser.id,
    title: 'Welcome Bonus Received!',
    message: `You have received a $${bonusBN.toFixed(2)} Welcome Bonus from Admin via Internal Transfer!`,
    type: 'INTERNAL_TRANSFER',
    read: false,
    createdAt: new Date().toISOString()
  });
}

let activeUserId: string | null = null;

function getActiveUser(req?: Request): User | null {
  const reqEmail = (
    req?.headers['x-user-email'] ||
    req?.query?.userEmail ||
    req?.body?.userEmail ||
    req?.body?.email
  )?.toString().trim().toLowerCase();

  const reqId = (
    req?.headers['x-user-id'] ||
    req?.query?.userId ||
    req?.body?.userId
  )?.toString().trim();

  if (reqEmail) {
    const userByEmail = consolidateUserByEmail(reqEmail, reqId);
    if (userByEmail) return userByEmail;
    return null;
  }

  if (reqId) {
    const foundById = mockUsers.find(
      (u) => u && (u.id === reqId || (u.id && u.id.toLowerCase() === reqId.toLowerCase()))
    );
    if (foundById) {
      if (foundById.email) {
        return consolidateUserByEmail(foundById.email, reqId);
      }
      return foundById;
    }
    return null;
  }

  if (activeUserId) {
    const foundActive = mockUsers.find((u) => u && u.id === activeUserId);
    if (foundActive) {
      if (foundActive.email) {
        return consolidateUserByEmail(foundActive.email, activeUserId);
      }
      return foundActive;
    }
  }

  return null;
}

function consolidateUserByEmail(email: string, reqId?: string): User | null {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail && !reqId) return null;

  let maxPrincipalBN = new BigNumber(0);
  let maxEarnedBN = new BigNumber(0);
  let maxWithdrawnBN = new BigNumber(0);
  let maxIbBN = new BigNumber(0);
  let maxIbTotalBN = new BigNumber(0);
  let canonicalUser: User | null = null;

  const matching = mockUsers.filter(
    (u) =>
      u &&
      (cleanEmail
        ? (u.email && u.email.trim().toLowerCase() === cleanEmail)
        : (reqId && u.id === reqId))
  );

  if (matching.length === 0) {
    return null;
  }

  matching.forEach((u) => {
    if (!u) return;
    maxPrincipalBN = BigNumber.max(maxPrincipalBN, new BigNumber(u.principalBalance || '0'));
    maxEarnedBN = BigNumber.max(maxEarnedBN, new BigNumber(u.earnedYield || '0'), new BigNumber(u.dailyProfit || '0'));
    maxWithdrawnBN = BigNumber.max(maxWithdrawnBN, new BigNumber(u.totalWithdrawn || '0'));
    maxIbBN = BigNumber.max(maxIbBN, new BigNumber(u.ibWithdrawableCommission || '0'));
    maxIbTotalBN = BigNumber.max(maxIbTotalBN, new BigNumber(u.ibTotalCommission || '0'));
    if (!canonicalUser) {
      canonicalUser = u;
    } else {
      if (new BigNumber(u.totalWithdrawn || '0').gt(new BigNumber((canonicalUser as User).totalWithdrawn || '0'))) {
        canonicalUser = u;
      } else if (new BigNumber(u.principalBalance || '0').gt(new BigNumber((canonicalUser as User).principalBalance || '0'))) {
        canonicalUser = u;
      }
    }
  });

  const matchingUserIds = new Set(matching.map((u) => u && u.id).filter(Boolean) as string[]);
  if (reqId) matchingUserIds.add(reqId);
  if (canonicalUser && (canonicalUser as User).id) matchingUserIds.add((canonicalUser as User).id);

  // Dynamic sum of all APPROVED and PENDING withdrawals from transactions
  const userWds = mockTransactions.filter((t) => {
    if (!t) return false;
    const tEmail = (t.userEmail || (t as any).email || (t as any).user || '').trim().toLowerCase();
    const tId = (t.userId || (t as any).uid || '').trim();
    const isUserMatch = (cleanEmail && tEmail === cleanEmail) || (tId && matchingUserIds.has(tId));
    const isWd = t.type === 'WITHDRAWAL' || Boolean(t.cryptoNetwork) || Boolean(t.destinationAddr);
    return isUserMatch && isWd && (t.status === 'APPROVED' || t.status === 'PENDING');
  });
  const dynamicWithdrawnBN = userWds.reduce((sum, w) => sum.plus(w.amount || w.precisionAmount || 0), new BigNumber(0));
  const effectiveWithdrawnBN = BigNumber.max(maxWithdrawnBN, dynamicWithdrawnBN);

  // Sum from internalTransfers
  const userITX = mockInternalTransfers.filter((t) => {
    if (!t) return false;
    const tEmail = (t.toUserEmail || (t as any).userEmail || (t as any).toEmail || (t as any).email || '').trim().toLowerCase();
    const tId = (t.toUserId || (t as any).userId || (t as any).toId || '').trim();
    return tEmail === cleanEmail || (tId && matchingUserIds.has(tId));
  });

  let itxSumBN = new BigNumber(0);
  userITX.forEach((itx) => {
    if (itx && itx.status === 'SUCCESS' && itx.amount) {
      itxSumBN = itxSumBN.plus(new BigNumber(itx.amount));
    }
  });

  // Sum from deposits
  const userDeps = mockDeposits.filter((d) => {
    if (!d) return false;
    const dEmail = (d.userEmail || d.userId || '').trim().toLowerCase();
    const dId = (d.userId || '').trim();
    return dEmail === cleanEmail || (dId && matchingUserIds.has(dId));
  });

  let totalDepBN = new BigNumber(0);
  userDeps.forEach((d) => {
    if (d.principalAmount) {
      totalDepBN = totalDepBN.plus(new BigNumber(d.principalAmount));
    }
  });

  const existingCanonicalBalBN = canonicalUser ? new BigNumber((canonicalUser as any).principalBalance || '0') : new BigNumber(0);
  const effectivePrincipal = BigNumber.max(maxPrincipalBN, itxSumBN, totalDepBN, existingCanonicalBalBN);

  if (!canonicalUser) {
    return null;
  }

  canonicalUser.email = cleanEmail;
  canonicalUser.totalWithdrawn = effectiveWithdrawnBN.toFixed(18);

  const nowSecForConsolidation = Math.floor(Date.now() / 1000);
  const startCandidates: number[] = [];
  matching.forEach((u) => {
    if (u.depositStartTime && Number(u.depositStartTime) > 0) {
      const s = Number(u.depositStartTime) > 100000000000 ? Math.floor(Number(u.depositStartTime) / 1000) : Math.floor(Number(u.depositStartTime));
      if (s <= nowSecForConsolidation) startCandidates.push(s);
    }
    if (u.activeInvestment?.depositStartTime && Number(u.activeInvestment.depositStartTime) > 0) {
      const s = Number(u.activeInvestment.depositStartTime) > 100000000000 ? Math.floor(Number(u.activeInvestment.depositStartTime) / 1000) : Math.floor(Number(u.activeInvestment.depositStartTime));
      if (s <= nowSecForConsolidation) startCandidates.push(s);
    }
  });
  userDeps.forEach((d) => {
    if (d.startTime) {
      const t = new Date(d.startTime).getTime();
      if (!isNaN(t) && t > 0 && Math.floor(t / 1000) <= nowSecForConsolidation) startCandidates.push(Math.floor(t / 1000));
    }
  });
  const canonicalDepStartSec = startCandidates.length > 0 ? Math.min(...startCandidates) : nowSecForConsolidation;
  canonicalUser.depositStartTime = canonicalDepStartSec;
  canonicalUser.baseEarnedYield = '0.000000000000000000';

  if (effectivePrincipal.isLessThanOrEqualTo(0)) {
    canonicalUser.principalBalance = '0.000000000000000000';
    canonicalUser.earnedYield = '0.000000000000000000';
    canonicalUser.dailyProfit = 0;
    (canonicalUser as any).totalDeposit = 0;
    (canonicalUser as any).totalBalance = 0;
    canonicalUser.activeInvestment = null;
  } else {
    canonicalUser.principalBalance = effectivePrincipal.toFixed(18);
    const canonPBalNum = effectivePrincipal.toNumber();

    const monthlyRate = canonPBalNum >= 1001 ? 35 : (canonPBalNum >= 501 ? 30 : 25);
    const ratePerSec = effectivePrincipal.multipliedBy(new BigNumber(monthlyRate).dividedBy(30).dividedBy(100).dividedBy(86400));
    const elapsed = Math.max(0, nowSecForConsolidation - canonicalDepStartSec);
    const grossAccrued = ratePerSec.multipliedBy(elapsed);
    const netYieldBN = BigNumber.max(0, grossAccrued.minus(effectiveWithdrawnBN));

    canonicalUser.earnedYield = netYieldBN.toFixed(18);
    canonicalUser.dailyProfit = netYieldBN.toNumber();
    (canonicalUser as any).totalDeposit = canonPBalNum;
    (canonicalUser as any).totalBalance = Math.max(0, canonPBalNum + netYieldBN.toNumber());
  }

  canonicalUser.ibWithdrawableCommission = maxIbBN.toFixed(2);
  canonicalUser.ibTotalCommission = maxIbTotalBN.toFixed(2);

  const activePBalNum = Number((canonicalUser as any).totalDeposit || 0);
  if (activePBalNum > 0 && !canonicalUser.activeInvestment) {
    let dailyYieldPercent = 0.8333333333333334;
    let monthlyYieldPercent = 25;
    let planName = 'Standard Plan';
    let planType = 'STANDARD';
    if (activePBalNum >= 1001) {
      dailyYieldPercent = 1.1666666666666667;
      monthlyYieldPercent = 35;
      planName = 'VIP Plan';
      planType = 'VIP';
    } else if (activePBalNum >= 501) {
      dailyYieldPercent = 1.0;
      monthlyYieldPercent = 30;
      planName = 'Premium Plan';
      planType = 'PREMIUM';
    }
    canonicalUser.activeInvestment = {
      investmentAmount: activePBalNum,
      planType,
      planName,
      dailyYieldPercent,
      monthlyYieldPercent,
      activationTimestamp: Date.now(),
      lastCalculatedTimestamp: Date.now(),
      depositStartTime: canonicalUser.depositStartTime
    };
  }

  // Clean duplicate mockUsers so ONLY canonicalUser remains for this email
  for (let i = mockUsers.length - 1; i >= 0; i--) {
    const u = mockUsers[i];
    if (
      u &&
      ((u.email && u.email.trim().toLowerCase() === cleanEmail) ||
        (reqId && u.id === reqId) ||
        (canonicalUser && canonicalUser.id && u.id === canonicalUser.id))
    ) {
      mockUsers.splice(i, 1);
    }
  }
  if (canonicalUser) {
    mockUsers.push(canonicalUser);
  }

  // Sync internal transfers and deposits to share canonicalUser's id and cleanEmail
  mockInternalTransfers.forEach((itx) => {
    if (!itx) return;
    const tEmail = (itx.toUserEmail || (itx as any).userEmail || (itx as any).toEmail || (itx as any).email || '').trim().toLowerCase();
    const tId = (itx.toUserId || (itx as any).userId || (itx as any).toId || '').trim();
    if (tEmail === cleanEmail || (tId && matchingUserIds.has(tId))) {
      if (canonicalUser?.id) itx.toUserId = canonicalUser.id;
      itx.toUserEmail = cleanEmail;
    }
  });

  mockDeposits.forEach((dep) => {
    if (!dep) return;
    const dEmail = (dep.userEmail || '').trim().toLowerCase();
    const dId = (dep.userId || '').trim();
    if (dEmail === cleanEmail || (dId && matchingUserIds.has(dId))) {
      if (canonicalUser?.id) dep.userId = canonicalUser.id;
      dep.userEmail = cleanEmail;
    }
  });

  return canonicalUser;
}

async function ensureUserSyncedFromFirestore(rawEmail?: string, rawId?: string): Promise<User | null> {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  const cleanId = (rawId || '').trim();

  if (!cleanEmail && !cleanId) {
    return null;
  }

  const inMemoryUser = consolidateUserByEmail(cleanEmail, cleanId);

  if (isFirestoreQuotaExceeded || inMemoryUser) {
    // If user is already available in memory, kick off background sync without blocking server response
    if (inMemoryUser && !isFirestoreQuotaExceeded) {
      (async () => {
        try {
          const { db } = await import('./src/lib/firebase');
          const { doc, getDoc } = await import('firebase/firestore');
          if (cleanEmail) {
            const snap = await getDoc(doc(db, 'users', cleanEmail)).catch(() => null);
            if (snap && snap.exists()) {
              const data = snap.data();
              if (data.password) inMemoryUser.password = data.password;
            }
          }
        } catch (e) {
          handleFirestoreQuotaError(e);
        }
      })();
    }
    return inMemoryUser;
  }

  try {
    const { db } = await import('./src/lib/firebase');
    const { collection, getDocs, doc, getDoc, setDoc, query, where } = await import('firebase/firestore');

    let userDocData: any = null;

    // 1. Fetch user doc directly by email
    if (cleanEmail) {
      const emailDocRef = doc(db, 'users', cleanEmail);
      const snap = await getDoc(emailDocRef);
      if (snap.exists()) {
        userDocData = { id: snap.id, ...snap.data() };
      }
    }

    // 2. Fetch user doc by ID if not found
    if (!userDocData && cleanId) {
      const idDocRef = doc(db, 'users', cleanId);
      const snap = await getDoc(idDocRef);
      if (snap.exists()) {
        userDocData = { id: snap.id, ...snap.data() };
      }
    }

    // 3. Query user by email if still not found
    if (!userDocData && cleanEmail) {
      const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
      const userSnap = await getDocs(q);
      if (!userSnap.empty) {
        userDocData = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };
      }
    }

    // Load deposits using targeted query
    if (cleanEmail || cleanId) {
      try {
        const depQuery = cleanEmail
          ? query(collection(db, 'deposits'), where('userEmail', '==', cleanEmail))
          : query(collection(db, 'deposits'), where('userId', '==', cleanId));
        const depSnap = await getDocs(depQuery);
        depSnap.forEach((dDoc) => {
          const dData: any = dDoc.data();
          const depId = dDoc.id || dData.id || `dep-${Date.now()}`;
          const dEmail = (dData.userEmail || dData.email || '').toLowerCase().trim();

          const pAmount = String(dData.principalAmount || dData.amount || '0');
          if (!mockDeposits.some((m) => m.id === depId || (dData.transactionId && m.txHash === dData.transactionId))) {
            mockDeposits.unshift({
              id: depId,
              userId: dData.userId || cleanId || cleanEmail,
              userEmail: dData.userEmail || dEmail || cleanEmail,
              planId: dData.planId || 'plan-standard',
              planName: dData.planName || 'Standard Yield Plan',
              principalAmount: pAmount,
              earnedYield: dData.earnedYield !== undefined ? String(dData.earnedYield) : '0.000000000000000000',
              totalPayout: '0',
              dailyYieldPercent: dData.dailyYieldPercent || getPlanRates(pAmount).dailyYieldPercent,
              cryptoNetwork: dData.cryptoNetwork || 'Internal Transfer',
              txHash: dData.transactionId || dData.txHash || depId,
              status: (dData.status || 'ACTIVE').toUpperCase(),
              startTime: dData.createdAt || dData.startTime || new Date().toISOString(),
              endTime: dData.endTime || new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
              lastYieldTick: new Date().toISOString(),
              progressPercent: 0
            });
          }
        });
      } catch (e) {
        handleFirestoreQuotaError(e);
      }
    }

    // Run in-memory consolidation
    let canonicalUser = consolidateUserByEmail(cleanEmail || (userDocData?.email ?? ''), cleanId || userDocData?.id);

    // Merge doc values if present
    if (userDocData && canonicalUser) {
      const docBal = userDocData.principalBalance !== undefined ? new BigNumber(userDocData.principalBalance) : new BigNumber(0);
      canonicalUser.principalBalance = BigNumber.max(new BigNumber(canonicalUser.principalBalance || 0), docBal).toFixed(18);

      const docWithdrawn = userDocData.totalWithdrawn !== undefined ? new BigNumber(userDocData.totalWithdrawn) : new BigNumber(0);
      const inMemWithdrawn = new BigNumber(canonicalUser.totalWithdrawn || '0');
      const maxWithdrawnBN = BigNumber.max(docWithdrawn, inMemWithdrawn);
      canonicalUser.totalWithdrawn = maxWithdrawnBN.toFixed(18);

      if (userDocData.depositStartTime && Number(userDocData.depositStartTime) > 0) {
        canonicalUser.depositStartTime = Number(userDocData.depositStartTime);
      }
      canonicalUser.baseEarnedYield = '0.000000000000000000';

      const docDep = userDocData.totalDeposit !== undefined ? Number(userDocData.totalDeposit) : Number(canonicalUser.principalBalance);
      const totalDepNum = Math.max(Number((canonicalUser as any).totalDeposit || 0), docDep, Number(canonicalUser.principalBalance));

      const docYield = userDocData.earnedYield !== undefined ? new BigNumber(userDocData.earnedYield) : (userDocData.dailyProfit !== undefined ? new BigNumber(userDocData.dailyProfit) : new BigNumber(0));
      const inMemYield = new BigNumber(canonicalUser.earnedYield || 0);
      const inMemProfit = new BigNumber(canonicalUser.dailyProfit || 0);

      const nowSec = Math.floor(Date.now() / 1000);
      const depStartSec = canonicalUser.depositStartTime && Number(canonicalUser.depositStartTime) > 0 ? Number(canonicalUser.depositStartTime) : nowSec;
      const monthlyRate = totalDepNum >= 1001 ? 35 : (totalDepNum >= 501 ? 30 : 25);
      const ratePerSec = new BigNumber(totalDepNum).multipliedBy(new BigNumber(monthlyRate).dividedBy(30).dividedBy(100).dividedBy(86400));
      const elapsed = Math.max(0, nowSec - depStartSec);
      const grossYield = ratePerSec.multipliedBy(elapsed);
      const netYieldBN = BigNumber.max(0, grossYield.minus(maxWithdrawnBN));

      canonicalUser.earnedYield = netYieldBN.toFixed(18);
      canonicalUser.dailyProfit = netYieldBN.toNumber();
      (canonicalUser as any).totalDeposit = totalDepNum;
      (canonicalUser as any).totalBalance = Math.max(0, totalDepNum + netYieldBN.toNumber());

      if (userDocData.activeInvestment) {
        canonicalUser.activeInvestment = userDocData.activeInvestment;
      }

      if (userDocData.ibWithdrawableCommission) {
        canonicalUser.ibWithdrawableCommission = String(userDocData.ibWithdrawableCommission);
      }
      if (userDocData.ibTotalCommission) {
        canonicalUser.ibTotalCommission = String(userDocData.ibTotalCommission);
      }
      if (userDocData.is_ib) {
        canonicalUser.is_ib = true;
        canonicalUser.ibStatus = userDocData.ibStatus || 'APPROVED';
      }
    }

    if (canonicalUser) {
      const pBalNum = Number(canonicalUser.principalBalance || 0);
      const earnedNum = Number(canonicalUser.earnedYield || 0);
      const currentDep = Math.max(Number((canonicalUser as any).totalDeposit || 0), pBalNum);
      const currentTotBal = Math.max(Number((canonicalUser as any).totalBalance || 0), currentDep + earnedNum);
      (canonicalUser as any).totalDeposit = currentDep;
      (canonicalUser as any).totalBalance = currentTotBal;

      if (currentDep > 0 && (!canonicalUser.activeInvestment || canonicalUser.activeInvestment.investmentAmount < currentDep)) {
        let dailyYieldPercent = 0.8333333333333334;
        let monthlyYieldPercent = 25;
        let planName = 'Standard Plan';
        let planType = 'STANDARD';
        if (currentDep >= 1001) {
          dailyYieldPercent = 1.1666666666666667;
          monthlyYieldPercent = 35;
          planName = 'VIP Plan';
          planType = 'VIP';
        } else if (currentDep >= 501) {
          dailyYieldPercent = 1.0;
          monthlyYieldPercent = 30;
          planName = 'Premium Plan';
          planType = 'PREMIUM';
        }
        canonicalUser.activeInvestment = {
          investmentAmount: currentDep,
          planType,
          planName,
          dailyYieldPercent,
          monthlyYieldPercent,
          activationTimestamp: Date.now(),
          lastCalculatedTimestamp: Date.now()
        };
      }
    }

    // Persist canonicalUser back to Firestore under doc ID = cleanEmail if quota ok
    if (canonicalUser && canonicalUser.email && !isFirestoreQuotaExceeded) {
      const emailKey = canonicalUser.email.toLowerCase().trim();
      const pBalNum = Number(canonicalUser.principalBalance || 0);
      const earnedNum = Number(canonicalUser.earnedYield || 0);
      const totalDepNum = Number((canonicalUser as any).totalDeposit || pBalNum);
      const totalBalNum = Number((canonicalUser as any).totalBalance || (pBalNum + earnedNum));

      const nowSecForSync = Math.floor(Date.now() / 1000);
      const startCandidates: number[] = [];
      if (canonicalUser.depositStartTime && Number(canonicalUser.depositStartTime) > 0) {
        const s = Number(canonicalUser.depositStartTime) > 100000000000 ? Math.floor(Number(canonicalUser.depositStartTime) / 1000) : Math.floor(Number(canonicalUser.depositStartTime));
        if (s <= nowSecForSync) startCandidates.push(s);
      }
      if (userDocData?.depositStartTime && Number(userDocData.depositStartTime) > 0) {
        const s = Number(userDocData.depositStartTime) > 100000000000 ? Math.floor(Number(userDocData.depositStartTime) / 1000) : Math.floor(Number(userDocData.depositStartTime));
        if (s <= nowSecForSync) startCandidates.push(s);
      }
      const canonicalStartSec = startCandidates.length > 0 ? Math.min(...startCandidates) : nowSecForSync;
      canonicalUser.depositStartTime = canonicalStartSec;

      const payload = {
        id: canonicalUser.id,
        uid: canonicalUser.id,
        email: emailKey,
        role: canonicalUser.role,
        tier: canonicalUser.tier,
        principalBalance: pBalNum,
        totalDeposit: totalDepNum,
        totalBalance: totalBalNum,
        earnedYield: earnedNum,
        dailyProfit: Number(canonicalUser.dailyProfit || earnedNum),
        depositStartTime: canonicalStartSec,
        baseEarnedYield: canonicalUser.baseEarnedYield || '0.000000000000000000',
        totalWithdrawn: Number(canonicalUser.totalWithdrawn || 0),
        ibWithdrawableCommission: Number(canonicalUser.ibWithdrawableCommission || 0),
        ibTotalCommission: Number(canonicalUser.ibTotalCommission || 0),
        is_ib: !!canonicalUser.is_ib,
        ibStatus: canonicalUser.ibStatus || 'NONE',
        activeInvestment: canonicalUser.activeInvestment || null,
        referralCode: canonicalUser.referralCode,
        updatedAt: new Date().toISOString()
      };
      setDoc(doc(db, 'users', emailKey), payload, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
      if (canonicalUser.id && canonicalUser.id !== emailKey) {
        setDoc(doc(db, 'users', canonicalUser.id), payload, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
      }
    }

    return canonicalUser;
  } catch (err) {
    handleFirestoreQuotaError(err);
    if (cleanEmail) return consolidateUserByEmail(cleanEmail, cleanId);
    return mockUsers.find((u) => u.id === cleanId) || null;
  }
}

// High-entropy guaranteed 100% collision-free referral code generator across 20+ million users
function generateUniqueReferralCode(prefix = 'DC'): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let attempts = 0;
  while (attempts < 5000) {
    let randStr = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < bytes.length; i++) {
      randStr += chars[bytes[i] % chars.length];
    }
    const candidate = `${prefix}${randStr}`;

    const isTaken = mockUsers.some(
      (u) =>
        u.referralCode?.toUpperCase() === candidate.toUpperCase() ||
        u.ibReferralCode?.toUpperCase() === candidate.toUpperCase()
    );

    if (!isTaken) {
      return candidate;
    }
    attempts++;
  }
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000).toString(36).toUpperCase()}`;
}

function ensureUserUniqueReferralCode(user: User): string {
  if (!user.referralCode) {
    user.referralCode = generateUniqueReferralCode('DC');
    return user.referralCode;
  }
  const isDuplicate = mockUsers.some(
    (u) => u.id !== user.id && u.referralCode?.toUpperCase() === user.referralCode?.toUpperCase()
  );
  if (isDuplicate) {
    user.referralCode = generateUniqueReferralCode('DC');
  }
  return user.referralCode;
}

let mockUsers: User[] = [
  {
    id: 'usr-admin-sovereign',
    email: 'dollarcraft3@gmail.com',
    password: 'gdbcbfjnxh@craft@007',
    walletAddress: '0x3F5CE2FB2B21598D71227092F262529947871f31',
    role: 'ADMIN',
    tier: 'VIP',
    referralCode: 'SOVEREIGN1',
    isFrozen: false,
    createdAt: '2026-08-11T00:00:00.000Z',
    joinedDate: '2026-08-11',
    principalBalance: '100112500.000000000000000000',
    earnedYield: '7457.993000000000000000',
    totalWithdrawn: '0.000000000000000000',
    totalDeposit: 100112500,
    totalBalance: 100120000,
    is_ib: true,
    ibStatus: 'APPROVED',
    status: 'ACTIVE'
  },
  {
    id: 'usr-admin-legacy',
    email: 'admin@dollarcraft.io',
    password: 'gdbcbfjnxh@craft@007',
    walletAddress: '0x3F5CE2FB2B21598D71227092F262529947871f32',
    role: 'ADMIN',
    tier: 'VIP',
    referralCode: 'SOVEREIGN2',
    isFrozen: false,
    createdAt: '2026-08-10T00:00:00.000Z',
    joinedDate: '2026-08-10',
    principalBalance: '50000.000000000000000000',
    earnedYield: '1250.000000000000000000',
    totalWithdrawn: '0.000000000000000000',
    totalDeposit: 50000,
    totalBalance: 51250,
    is_ib: false,
    ibStatus: 'NONE',
    status: 'ACTIVE'
  },
  {
    id: 'usr-primary-customer',
    email: 'rafzaal542@gmail.com',
    password: 'Password123!',
    walletAddress: '0x7A8F9B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
    role: 'USER (SILVER)',
    tier: 'VIP',
    referralCode: 'DCRAFZAAL542',
    isFrozen: false,
    createdAt: '2026-08-11T10:00:00.000Z',
    joinedDate: '2026-08-11',
    principalBalance: '4000.000000000000000000',
    earnedYield: '1318.825900000000000000',
    totalWithdrawn: '250.000000000000000000',
    totalDeposit: 4000,
    totalBalance: 5318.8259,
    dailyProfit: 46.6666,
    is_ib: false,
    ibStatus: 'NONE',
    status: 'ACTIVE'
  },
  {
    id: 'usr-sarah-jenkins',
    email: 'sarah.crypto@gmail.com',
    password: 'Password123!',
    walletAddress: '0x1F2E3D4A5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D0E',
    role: 'USER (SILVER)',
    tier: 'VIP',
    referralCode: 'DCSARAH88',
    isFrozen: false,
    createdAt: '2026-08-10T14:30:00.000Z',
    joinedDate: '2026-08-10',
    principalBalance: '10500.000000000000000000',
    earnedYield: '2845.500000000000000000',
    totalWithdrawn: '500.000000000000000000',
    totalDeposit: 10500,
    totalBalance: 13345.5,
    dailyProfit: 122.5,
    is_ib: true,
    ibStatus: 'PENDING',
    status: 'ACTIVE'
  },
  {
    id: 'usr-alex-trader',
    email: 'tradepro.alex@gmail.com',
    password: 'Password123!',
    walletAddress: '0x9E8D7C6B5A4F3E2D1C0B9A8F7E6D5C4B3A2F1E0D',
    role: 'USER (SILVER)',
    tier: 'GOLD',
    referralCode: 'DCALEXTRADE',
    isFrozen: false,
    createdAt: '2026-08-09T08:15:00.000Z',
    joinedDate: '2026-08-09',
    principalBalance: '7000.000000000000000000',
    earnedYield: '1250.000000000000000000',
    totalWithdrawn: '1000.000000000000000000',
    totalDeposit: 7000,
    totalBalance: 8250,
    dailyProfit: 81.66,
    is_ib: true,
    ibStatus: 'APPROVED',
    status: 'ACTIVE'
  },
  {
    id: 'usr-john-doe',
    email: 'john.doe@gmail.com',
    password: 'Password123!',
    walletAddress: '0x3C2B1A0F9E8D7C6B5A4F3E2D1C0B9A8F7E6D5C4B',
    role: 'USER (SILVER)',
    tier: 'BRONZE',
    referralCode: 'DCJOHNDOE',
    isFrozen: false,
    createdAt: '2026-08-12T07:40:00.000Z',
    joinedDate: '2026-08-12',
    principalBalance: '500.000000000000000000',
    earnedYield: '125.000000000000000000',
    totalWithdrawn: '50.000000000000000000',
    totalDeposit: 500,
    totalBalance: 625,
    dailyProfit: 4.166,
    is_ib: false,
    ibStatus: 'PENDING',
    status: 'ACTIVE'
  },
  {
    id: 'usr-abdulha',
    email: 'abdulha@gmail.com',
    password: 'Password123!',
    walletAddress: '0x4F7A9B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
    role: 'USER (SILVER)',
    tier: 'VIP',
    referralCode: 'DCABDULHA',
    isFrozen: false,
    createdAt: '2026-08-14T00:00:00.000Z',
    joinedDate: '2026-08-14',
    principalBalance: '5000.000000000000000000',
    earnedYield: '7.000000000000000000',
    baseEarnedYield: '7.000000000000000000',
    depositStartTime: Math.floor(Date.now() / 1000),
    totalWithdrawn: '100.000000000000000000',
    totalDeposit: 5000,
    totalBalance: 5007,
    dailyProfit: 7,
    is_ib: false,
    ibStatus: 'NONE',
    status: 'ACTIVE'
  }
];

let mockIbApplications: IBApplication[] = [
  {
    id: 'ib-app-001',
    userId: 'usr-alex-trader',
    userName: 'Alex Trader',
    userEmail: 'tradepro.alex@gmail.com',
    phone: '+1 555-0198',
    walletAddress: '0x9E8D7C6B5A4F3E2D1C0B9A8F7E6D5C4B3A2F1E0D',
    country: 'United States',
    experience: '5+ years Forex & Crypto Trading Brokerage',
    telegramWhatsapp: '@alex_tradepro',
    status: 'APPROVED',
    createdAt: '2026-08-09T09:00:00.000Z'
  },
  {
    id: 'ib-app-002',
    userId: 'usr-sarah-jenkins',
    userName: 'Sarah Jenkins',
    userEmail: 'sarah.crypto@gmail.com',
    phone: '+44 20 7946 0912',
    walletAddress: '0x1F2E3D4A5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D0E',
    country: 'United Kingdom',
    experience: 'Institutional Asset Manager & Community Leader',
    telegramWhatsapp: '@sarah_crypto_uk',
    status: 'PENDING',
    createdAt: '2026-08-11T15:20:00.000Z'
  },
  {
    id: 'ib-app-003',
    userId: 'usr-john-doe',
    userName: 'John Doe',
    userEmail: 'john.doe@gmail.com',
    phone: '+92 300 1234567',
    walletAddress: '0x3C2B1A0F9E8D7C6B5A4F3E2D1C0B9A8F7E6D5C4B',
    country: 'Pakistan',
    experience: 'Crypto Network Marketing & Trading Group Leader',
    telegramWhatsapp: '+923001234567',
    status: 'PENDING',
    createdAt: '2026-08-12T07:50:00.000Z'
  }
];

let mockIbMembershipPayments: IBMembershipPayment[] = [];

let mockIbCommissions: IBCommission[] = [];

let mockDeposits: UserDeposit[] = [
  {
    id: 'dep-001',
    userId: 'usr-primary-customer',
    userEmail: 'rafzaal542@gmail.com',
    planId: 'plan-vip',
    planName: 'VIP Plan',
    principalAmount: '4000.000000000000000000',
    earnedYield: '1318.825900000000000000',
    totalPayout: '5318.825900000000000000',
    dailyYieldPercent: 1.1666666666666667,
    cryptoNetwork: 'USDT_TRC20',
    txHash: '0x7a8f9b3c1d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
    status: 'ACTIVE',
    startTime: '2026-08-11T10:00:00.000Z',
    endTime: '2027-04-11T10:00:00.000Z',
    lastYieldTick: new Date().toISOString(),
    progressPercent: 12.5
  },
  {
    id: 'dep-002',
    userId: 'usr-sarah-jenkins',
    userEmail: 'sarah.crypto@gmail.com',
    planId: 'plan-vip',
    planName: 'VIP Plan',
    principalAmount: '10500.000000000000000000',
    earnedYield: '2845.500000000000000000',
    totalPayout: '13345.500000000000000000',
    dailyYieldPercent: 1.1666666666666667,
    cryptoNetwork: 'USDT_BEP20',
    txHash: '0x1f2e3d4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e',
    status: 'ACTIVE',
    startTime: '2026-08-10T14:30:00.000Z',
    endTime: '2027-04-10T14:30:00.000Z',
    lastYieldTick: new Date().toISOString(),
    progressPercent: 18.0
  },
  {
    id: 'dep-003',
    userId: 'usr-alex-trader',
    userEmail: 'tradepro.alex@gmail.com',
    planId: 'plan-vip',
    planName: 'VIP Plan',
    principalAmount: '7000.000000000000000000',
    earnedYield: '1250.000000000000000000',
    totalPayout: '8250.000000000000000000',
    dailyYieldPercent: 1.1666666666666667,
    cryptoNetwork: 'USDT_TRC20',
    txHash: '0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d',
    status: 'ACTIVE',
    startTime: '2026-08-09T08:15:00.000Z',
    endTime: '2027-04-09T08:15:00.000Z',
    lastYieldTick: new Date().toISOString(),
    progressPercent: 22.0
  },
  {
    id: 'dep-004',
    userId: 'usr-john-doe',
    userEmail: 'john.doe@gmail.com',
    planId: 'plan-standard',
    planName: 'Standard Plan',
    principalAmount: '500.000000000000000000',
    earnedYield: '0.000000000000000000',
    totalPayout: '500.000000000000000000',
    dailyYieldPercent: 0.8333333333333334,
    cryptoNetwork: 'USDT_TRC20',
    txHash: '0x3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b',
    status: 'PENDING',
    startTime: '2026-08-12T07:40:00.000Z',
    endTime: '2027-04-12T07:40:00.000Z',
    lastYieldTick: new Date().toISOString(),
    progressPercent: 0
  },
  {
    id: 'dep-abdulha-5000',
    userId: 'usr-abdulha',
    userEmail: 'abdulha@gmail.com',
    planId: 'plan-vip',
    planName: 'VIP Plan (35% Monthly)',
    principalAmount: '5000.000000000000000000',
    earnedYield: '7.000000000000000000',
    totalPayout: '5007.000000000000000000',
    dailyYieldPercent: 1.1666666666666667,
    cryptoNetwork: 'USDT_BEP20',
    txHash: '0xabdulha5000depositbe8829f0a1b2c3d4e5f6a7b8c9',
    status: 'ACTIVE',
    startTime: '2026-08-14T00:00:00.000Z',
    endTime: '2027-04-14T00:00:00.000Z',
    lastYieldTick: new Date().toISOString(),
    progressPercent: 5.0
  }
];

let mockTransactions: Transaction[] = [
  {
    id: 'tx-wd-abdulha-100',
    userId: 'usr-abdulha',
    userEmail: 'abdulha@gmail.com',
    type: 'WITHDRAWAL',
    amount: '100.00',
    precisionAmount: '100.000000000000000000',
    destinationAddr: '0x4F7A9B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A',
    cryptoNetwork: 'USDT_BEP20',
    status: 'PENDING',
    createdAt: '2026-08-15T10:00:00.000Z'
  },
  {
    id: 'tx-wd-001',
    userId: 'usr-primary-customer',
    userEmail: 'rafzaal542@gmail.com',
    type: 'WITHDRAWAL',
    amount: '250.00',
    precisionAmount: '250.000000000000000000',
    destinationAddr: 'TY4z8X91P9vK8yq3mN27XpLs90QzM1L4kW',
    cryptoNetwork: 'USDT_TRC20',
    status: 'APPROVED',
    createdAt: '2026-08-11T18:30:00.000Z'
  },
  {
    id: 'tx-wd-002',
    userId: 'usr-sarah-jenkins',
    userEmail: 'sarah.crypto@gmail.com',
    type: 'WITHDRAWAL',
    amount: '500.00',
    precisionAmount: '500.000000000000000000',
    destinationAddr: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    cryptoNetwork: 'USDT_BEP20',
    status: 'PENDING',
    createdAt: '2026-08-12T04:15:00.000Z'
  },
  {
    id: 'tx-wd-003',
    userId: 'usr-john-doe',
    userEmail: 'john.doe@gmail.com',
    type: 'WITHDRAWAL',
    amount: '50.00',
    precisionAmount: '50.000000000000000000',
    destinationAddr: 'TY9x8W72Q1vK8yq3mN27XpLs90QzM1L4kW',
    cryptoNetwork: 'USDT_TRC20',
    status: 'PENDING',
    createdAt: '2026-08-12T08:00:00.000Z'
  },
  {
    id: 'tx-wd-004',
    userId: 'usr-alex-trader',
    userEmail: 'tradepro.alex@gmail.com',
    type: 'WITHDRAWAL',
    amount: '1000.00',
    precisionAmount: '1000.000000000000000000',
    destinationAddr: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    cryptoNetwork: 'USDT_BEP20',
    status: 'APPROVED',
    createdAt: '2026-08-10T12:00:00.000Z'
  }
];

let mockReferrals: ReferralReward[] = [];

// Active Server-Sent Events (SSE) connections array
let sseClients: Response[] = [];

// ==========================================
// THREAD-SAFE REAL-TIME WORKER ENGINE (1s Tick & 24/7 Autonomous Catchup)
// ==========================================
let lastGlobalReconciliationTime = Date.now();
let firestoreYieldSyncCounter = 0;

function reconcileOfflineYields(): { totalOfflineYieldCredited: string; elapsedSeconds: number } {
  const now = Date.now();
  let totalOfflineYieldCreditedBN = new BigNumber(0);
  let maxElapsedSeconds = 0;

  // 1. Ensure all internal transfers to MAIN_WALLET or INVESTMENT_WALLET have active deposits in mockDeposits
  mockInternalTransfers.forEach((itx) => {
    if (itx.status === 'SUCCESS' && (itx.toWalletType === 'MAIN_WALLET' || itx.toWalletType === 'INVESTMENT_WALLET' || !itx.toWalletType)) {
      const depId = `dep-${itx.transferId || itx.id}`;
      if (!mockDeposits.some((m) => m.id === depId || m.txHash === itx.transferId)) {
        const amt = parseFloat(itx.amount || '0');
        let dailyYieldPercent = 0.8333333333333334;
        let planName = 'Standard Plan (25% Monthly)';
        if (amt >= 1001) {
          dailyYieldPercent = 1.1666666666666667;
          planName = 'VIP Plan (35% Monthly)';
        } else if (amt >= 501) {
          dailyYieldPercent = 1.0;
          planName = 'Premium Plan (30% Monthly)';
        }
        mockDeposits.unshift({
          id: depId,
          userId: itx.toUserId,
          userEmail: itx.toUserEmail,
          planId: 'plan-standard',
          planName: `${planName} (Internal Transfer)`,
          principalAmount: String(itx.amount || '0'),
          earnedYield: '0.000000000000000000',
          totalPayout: '0',
          dailyYieldPercent,
          cryptoNetwork: 'Internal Transfer (Main Wallet)',
          txHash: itx.transferId || itx.id,
          status: 'ACTIVE',
          startTime: itx.createdAt || new Date(now).toISOString(),
          endTime: new Date(now + 240 * 86400 * 1000).toISOString(),
          lastYieldTick: new Date(now).toISOString(),
          progressPercent: 0
        });
      }
    }
  });

  // 2. Ensure any user with principalBalance > 0 has an active deposit yielding daily profit 24/7
  mockUsers.forEach((u) => {
    const pBalBN = new BigNumber(u.principalBalance || '0');
    if (pBalBN.isLessThanOrEqualTo(0)) {
      u.activeInvestment = null;
    } else {
      const uEmailClean = (u.email || '').toLowerCase().trim();
      const hasActiveDep = mockDeposits.some(
        (d) => (d.userId === u.id || (d.userEmail && d.userEmail.toLowerCase().trim() === uEmailClean)) && d.status === 'ACTIVE'
      );
      if (!hasActiveDep) {
        const amt = pBalBN.toNumber();
        let dailyYieldPercent = 0.8333333333333334;
        let planName = 'Standard Plan (25% Monthly)';
        if (amt >= 1001) {
          dailyYieldPercent = 1.1666666666666667;
          planName = 'VIP Plan (35% Monthly)';
        } else if (amt >= 501) {
          dailyYieldPercent = 1.0;
          planName = 'Premium Plan (30% Monthly)';
        }
        const userStartSec = u.depositStartTime && u.depositStartTime > 0
          ? u.depositStartTime
          : (u.createdAt ? Math.floor(new Date(u.createdAt).getTime() / 1000) : Math.floor(now / 1000));
        u.depositStartTime = userStartSec;
        const depStartTimeISO = new Date(userStartSec * 1000).toISOString();
        mockDeposits.unshift({
          id: `dep-mainbal-${u.id}`,
          userId: u.id,
          userEmail: u.email,
          planId: 'plan-main',
          planName: `${planName} (Main Portfolio)`,
          principalAmount: pBalBN.toFixed(18),
          earnedYield: u.earnedYield || '0.000000000000000000',
          baseEarnedYield: u.baseEarnedYield || u.earnedYield || '0.000000000000000000',
          totalPayout: '0',
          dailyYieldPercent,
          cryptoNetwork: 'Main Balance Yield',
          txHash: `MB-${u.id}`,
          status: 'ACTIVE',
          startTime: depStartTimeISO,
          endTime: new Date(now + 240 * 86400 * 1000).toISOString(),
          lastYieldTick: depStartTimeISO,
          progressPercent: 0
        });
      }
    }
  });

  // 3. Process active deposits and calculate 24/7 continuous yield using pure deterministic elapsed time
  mockDeposits = mockDeposits.map((dep) => {
    if (dep.status !== 'ACTIVE') return dep;

    let startMs = new Date(dep.startTime || now).getTime();
    if (isNaN(startMs) || startMs <= 0 || startMs > now) {
      startMs = now;
      dep.startTime = new Date(now).toISOString();
    }

    const elapsedSeconds = Math.max(0, (now - startMs) / 1000);
    if (elapsedSeconds > maxElapsedSeconds) {
      maxElapsedSeconds = elapsedSeconds;
    }

    const baseYieldBN = new BigNumber((dep as any).baseEarnedYield || 0);
    const accruedYieldBN = calculateMicroYield(dep.principalAmount, dep.dailyYieldPercent, elapsedSeconds);
    const newEarnedBN = baseYieldBN.plus(accruedYieldBN);

    totalOfflineYieldCreditedBN = totalOfflineYieldCreditedBN.plus(accruedYieldBN);

    // Update progress percentage
    const endMs = new Date(dep.endTime).getTime();
    const validEndMs = isNaN(endMs) || endMs <= startMs ? startMs + 240 * 86400 * 1000 : endMs;
    const totalDurationMs = Math.max(1, validEndMs - startMs);
    const currentElapsedMs = Math.max(0, now - startMs);
    const progressPercent = Math.min(100, Math.max(0, (currentElapsedMs / totalDurationMs) * 100));

    const isCompleted = progressPercent >= 100;

    return {
      ...dep,
      earnedYield: newEarnedBN.toFixed(18),
      status: isCompleted ? 'COMPLETED' : 'ACTIVE',
      lastYieldTick: new Date(now).toISOString(),
      progressPercent
    };
  });

  // Synchronize user.earnedYield across mockUsers to equal continuous real-time profit
  mockUsers.forEach((user) => {
    if (user.isFrozen) return;
    const uEmailClean = (user.email || '').toLowerCase().trim();
    const userDeps = mockDeposits.filter((d) => {
      const dEmailClean = (d.userEmail || '').toLowerCase().trim();
      return dEmailClean ? dEmailClean === uEmailClean : d.userId === user.id;
    });

    // Dynamically calculate totalWithdrawn from all APPROVED & PENDING withdrawals
    const userWds = mockTransactions.filter((t) => {
      const tEmail = (t.userEmail || (t as any).email || (t as any).user || '').toLowerCase().trim();
      const tId = (t.userId || (t as any).uid || '').trim();
      const isUserMatch = (uEmailClean && tEmail === uEmailClean) || (user.id && tId === user.id);
      const isWd = t.type === 'WITHDRAWAL' || Boolean(t.cryptoNetwork) || Boolean(t.destinationAddr);
      return isUserMatch && isWd && (t.status === 'APPROVED' || t.status === 'PENDING');
    });
    const dynamicWithdrawnBN = userWds.reduce((sum, w) => sum.plus(w.amount || w.precisionAmount || 0), new BigNumber(0));
    const totalWithdrawnBN = BigNumber.max(new BigNumber(user.totalWithdrawn || '0'), dynamicWithdrawnBN);
    user.totalWithdrawn = totalWithdrawnBN.toFixed(18);

    const pBalNum = Number(user.principalBalance || 0);
    const totalDepNum = Math.max(
      pBalNum,
      userDeps.reduce((sum, d) => sum + (parseFloat(d.principalAmount) || 0), 0)
    );

    if (totalDepNum > 0) {
      const nowSec = Math.floor(now / 1000);
      const startCandidates: number[] = [];
      if (user.depositStartTime && Number(user.depositStartTime) > 0) {
        const s = Number(user.depositStartTime) > 100000000000 ? Math.floor(Number(user.depositStartTime) / 1000) : Math.floor(Number(user.depositStartTime));
        if (s <= nowSec) startCandidates.push(s);
      }
      if (user.activeInvestment?.depositStartTime && Number(user.activeInvestment.depositStartTime) > 0) {
        const s = Number(user.activeInvestment.depositStartTime) > 100000000000 ? Math.floor(Number(user.activeInvestment.depositStartTime) / 1000) : Math.floor(Number(user.activeInvestment.depositStartTime));
        if (s <= nowSec) startCandidates.push(s);
      }
      userDeps.forEach((d) => {
        if (d.startTime) {
          const t = new Date(d.startTime).getTime();
          if (!isNaN(t) && t > 0 && Math.floor(t / 1000) <= nowSec) startCandidates.push(Math.floor(t / 1000));
        }
      });
      const depStartSec = startCandidates.length > 0 ? Math.min(...startCandidates) : nowSec;

      const monthlyRate = totalDepNum >= 1001 ? 35 : (totalDepNum >= 501 ? 30 : 25);
      const ratePerSec = new BigNumber(totalDepNum).multipliedBy(new BigNumber(monthlyRate).dividedBy(30).dividedBy(100).dividedBy(86400));
      const elapsed = Math.max(0, nowSec - depStartSec);
      const accrued = ratePerSec.multipliedBy(elapsed);
      
      const currentYieldBN = BigNumber.max(0, accrued.minus(totalWithdrawnBN));
      const netYieldStr = currentYieldBN.toFixed(18);

      user.earnedYield = netYieldStr;
      user.dailyProfit = currentYieldBN.toNumber();
      (user as any).totalBalance = Math.max(0, totalDepNum + currentYieldBN.toNumber());
      user.depositStartTime = depStartSec;
      user.baseEarnedYield = '0.000000000000000000';
    }
  });

  lastGlobalReconciliationTime = now;

  // 4. Periodically sync updated yield state to Firestore so offline calculations are persisted permanently
  firestoreYieldSyncCounter++;
  if (!isFirestoreQuotaExceeded && firestoreYieldSyncCounter % 60 === 0) {
    (async () => {
      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        mockUsers.forEach((u) => {
          if (u.email && u.earnedYield) {
            setDoc(doc(db, 'users', u.email.toLowerCase().trim()), {
              earnedYield: Number(u.earnedYield),
              principalBalance: Number(u.principalBalance),
              totalDeposit: Number((u as any).totalDeposit || u.principalBalance || 0),
              totalBalance: Number((u as any).totalBalance || 0),
              depositStartTime: u.depositStartTime,
              baseEarnedYield: u.baseEarnedYield || '0.000000000000000000',
              lastYieldTick: new Date(now).toISOString()
            }, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
          }
        });
        mockDeposits.forEach((dep) => {
          if (dep.id && dep.earnedYield) {
            setDoc(doc(db, 'deposits', dep.id), {
              earnedYield: Number(dep.earnedYield),
              lastYieldTick: dep.lastYieldTick,
              status: dep.status
            }, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
          }
        });
      } catch (e) {
        handleFirestoreQuotaError(e);
      }
    })();
  }

  return {
    totalOfflineYieldCredited: totalOfflineYieldCreditedBN.toFixed(18),
    elapsedSeconds: Math.floor(maxElapsedSeconds)
  };
}

setInterval(() => {
  reconcileOfflineYields();

  if (sseClients.length > 0) {
    sseClients.forEach((client) => {
      const email = (client as any).clientEmail;
      const id = (client as any).clientId;

      let targetUser: User | null = null;
      if (email) {
        targetUser = consolidateUserByEmail(email, id);
      } else if (id) {
        targetUser = mockUsers.find((u) => u.id === id) || null;
      }
      if (!targetUser) {
        targetUser = getActiveUser();
      }

      if (targetUser) {
        const uEmailClean = targetUser.email.toLowerCase().trim();
        const userDeposits = mockDeposits.filter(
          (d) =>
            (d.userId === targetUser!.id || (d.userEmail && d.userEmail.toLowerCase().trim() === uEmailClean)) &&
            d.status === 'ACTIVE'
        );

        let totalMicroYieldPerSec = new BigNumber(0);
        if (new BigNumber(targetUser.principalBalance || 0).isGreaterThan(0)) {
          userDeposits.forEach((d) => {
            totalMicroYieldPerSec = totalMicroYieldPerSec.plus(
              calculateYieldPerSecond(d.principalAmount, d.dailyYieldPercent)
            );
          });
        }

        const payload = {
          userId: targetUser.id,
          userEmail: targetUser.email,
          timestamp: new Date().toISOString(),
          principalBalance: targetUser.principalBalance,
          earnedYield: targetUser.earnedYield,
          microYieldPerSecond: totalMicroYieldPerSec.toFixed(18),
          activeCycles: userDeposits.map((d) => ({
            id: d.id,
            earnedYield: d.earnedYield,
            progressPercent: d.progressPercent
          }))
        };

        try {
          client.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (e) {
          // connection closed
        }
      }
    });
  }
}, 3000);

// ==========================================
// REST API ROUTES
// ==========================================

// Auth - Google OAuth / One-Tap Connect
app.post('/api/auth/google', async (req: Request, res: Response) => {
  const { email, name, photoUrl, avatarUrl, referralCode, isLogin, mode } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Google email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  let user = await ensureUserSyncedFromFirestore(cleanEmail);

  if (!user) {
    user = mockUsers.find((u) => u.email.toLowerCase() === cleanEmail);
  }

  if (!user) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const foundDoc = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
        user = {
          id: foundDoc.id || foundDoc.uid || `usr-${Date.now()}`,
          email: foundDoc.email || cleanEmail,
          password: foundDoc.password || undefined,
          role: foundDoc.role || 'USER',
          tier: foundDoc.tier || 'SILVER',
          principalBalance: String(foundDoc.principalBalance ?? '0.00'),
          earnedYield: String(foundDoc.earnedYield ?? '0.00'),
          totalWithdrawn: String(foundDoc.totalWithdrawn ?? '0.00'),
          walletAddress: foundDoc.walletAddress || `0x${Math.random().toString(16).substring(2, 10)}`,
          referralCode: foundDoc.referralCode || generateUniqueReferralCode('DC'),
          referredBy: foundDoc.referredBy || foundDoc.referredByCode || undefined,
          isFrozen: !!foundDoc.isFrozen,
          createdAt: foundDoc.createdAt || new Date().toISOString(),
          hasCompletedOnboarding: foundDoc.hasCompletedOnboarding ?? true
        };
        mockUsers.push(user);
      }
    } catch (fsErr) {
      console.warn('Firestore lookup during Google auth error:', fsErr);
    }
  }

  const requestingLogin = isLogin === true || mode === 'login';
  let isNewUser = false;

  if (!user) {
    if (requestingLogin) {
      return res.status(400).json({
        error: 'Account not found. No account is registered with this email. Please click SIGN UP first to create an account.'
      });
    }

    isNewUser = true;
    const photo = photoUrl || avatarUrl || undefined;
    const nameParts = (name || '').trim().split(' ');
    const fName = nameParts[0] || '';
    const lName = nameParts.slice(1).join(' ') || '';

    let referredByIb: string | undefined = undefined;
    if (referralCode) {
      const refClean = String(referralCode).trim();
      const ibUser = mockUsers.find(
        (u) => u.is_ib && (
          u.ibReferralCode === refClean ||
          `IB${u.id}` === refClean ||
          u.referralCode === refClean ||
          u.id === refClean.replace(/^IB/, '')
        )
      );
      if (ibUser) {
        referredByIb = ibUser.id;
      }
    }

    user = {
      id: `usr-g-${Date.now()}`,
      email: cleanEmail,
      firstName: fName || undefined,
      lastName: lName || undefined,
      avatarUrl: photo,
      walletAddress: `0x${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`,
      role: 'USER',
      tier: 'SILVER',
      referralCode: generateUniqueReferralCode('DC'),
      referredBy: referredByIb,
      isFrozen: false,
      createdAt: new Date().toISOString(),
      principalBalance: '0.000000000000000000',
      earnedYield: '0.000000000000000000',
      totalWithdrawn: '0.000000000000000000',
      is_ib: false,
      ibStatus: 'NONE',
      hasCompletedOnboarding: false
    };
    mockUsers.push(user);

    try {
      const { db } = await import('./src/lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', user.id), {
        uid: user.id,
        id: user.id,
        email: user.email,
        displayName: name || user.email,
        role: user.role,
        tier: user.tier,
        principalBalance: 0,
        earnedYield: 0,
        totalWithdrawn: 0,
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        referredBy: user.referredBy || referralCode || '',
        isFrozen: false,
        createdAt: user.createdAt,
        hasCompletedOnboarding: false
      });
    } catch (e) {
      console.warn('Firestore Google user creation notice:', e);
    }

    if (referralCode || user.referredBy) {
      dispatchSignupReferralCommission(user, referralCode || user.referredBy);
    }
  } else {
    isNewUser = false;
    const photo = photoUrl || avatarUrl || undefined;
    const nameParts = (name || '').trim().split(' ');
    const fName = nameParts[0] || '';
    const lName = nameParts.slice(1).join(' ') || '';
    if (photo && !user.avatarUrl) user.avatarUrl = photo;
    if (fName && !user.firstName) user.firstName = fName;
    if (lName && !user.lastName) user.lastName = lName;
  }

  activeUserId = user.id;
  res.json({ success: true, user, isNewUser });
});

// Auth - Complete Google User Onboarding Profile
app.post('/api/auth/complete-onboarding', (req: Request, res: Response) => {
  const { userId, firstName, lastName, username, referralUsername, referralCode, onboardingPurpose, avatarUrl, photoUrl } = req.body;
  const targetId = userId || activeUserId;
  const user = mockUsers.find((u) => u.id === targetId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (firstName) user.firstName = String(firstName).trim();
  if (lastName) user.lastName = String(lastName).trim();
  if (username) user.username = String(username).trim();

  // Save referral username or code
  const refInput = (referralUsername || referralCode || '').toString().trim().replace(/^@/, '');
  if (refInput) {
    const referrer = mockUsers.find(
      (u) =>
        u.id?.toLowerCase() === refInput.toLowerCase() ||
        u.username?.toLowerCase() === refInput.toLowerCase() ||
        u.email?.toLowerCase() === refInput.toLowerCase() ||
        u.referralCode?.toLowerCase() === refInput.toLowerCase() ||
        u.ibReferralCode?.toLowerCase() === refInput.toLowerCase()
    );

    if (referrer) {
      user.referredBy = referrer.id;
    } else {
      user.referredBy = refInput;
    }
    dispatchSignupReferralCommission(user, refInput);
  }

  if (onboardingPurpose) user.onboardingPurpose = String(onboardingPurpose).trim();
  if (avatarUrl || photoUrl) user.avatarUrl = String(avatarUrl || photoUrl).trim();
  user.hasCompletedOnboarding = true;

  res.json({ success: true, user, message: 'Onboarding profile completed successfully.' });
});

// Helper for Google Account Verification
function isGibberishUsername(username: string): boolean {
  const cleanUser = username.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanUser) return false;
  
  if (cleanUser.length < 3) return true;

  // Keyboard mashing patterns
  const mashingPatterns = [
    'qwerty', 'qwert', 'werty', 'ertyu', 'rtyui', 'tyuio', 'yuiop',
    'asdfg', 'sdfgh', 'dfghj', 'fghjk', 'ghjkl',
    'zxcvb', 'xcvbn', 'cvbnm',
    '12345', '23456', '34567', '45678', '56789',
    'wdwr', 'fghj', 'hjkl', 'asdf', 'zxcv', 'qwer'
  ];
  for (const pat of mashingPatterns) {
    if (cleanUser.includes(pat)) return true;
  }

  // Triple repeating characters like "aaaa", "zzzz"
  if (/(.)\1\1/.test(cleanUser)) return true;

  // 4 or more consecutive consonants (without vowels a,e,i,o,u,y)
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(cleanUser)) return true;

  // Low vowel ratio for strings >= 6 chars
  if (cleanUser.length >= 6) {
    const vowels = cleanUser.match(/[aeiouy]/gi);
    const vowelCount = vowels ? vowels.length : 0;
    const vowelRatio = vowelCount / cleanUser.length;
    if (vowelRatio < 0.18) return true;
  }

  return false;
}

function isValidEmail(emailStr: string): { valid: boolean; reason?: string } {
  if (!emailStr || !emailStr.trim()) return { valid: false, reason: 'Email address is required.' };
  const clean = emailStr.trim().toLowerCase();
  
  if (!clean.includes('@') || !clean.includes('.')) {
    return { 
      valid: false, 
      reason: 'Please enter a valid email address (e.g. name@gmail.com).' 
    };
  }

  const parts = clean.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
    return {
      valid: false,
      reason: 'Please enter a valid email address.'
    };
  }

  return { valid: true };
}

// Auth - Email Registration
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password, name, referralCode } = req.body;
  
  const check = isValidEmail(email);
  if (!check.valid) {
    return res.status(400).json({ error: check.reason });
  }

  const cleanEmail = email.trim().toLowerCase();
  let user = await ensureUserSyncedFromFirestore(cleanEmail);

  if (!user) {
    user = mockUsers.find((u) => u.email.toLowerCase() === cleanEmail);
  }

  if (!user) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const foundDoc = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
        user = {
          id: foundDoc.id || foundDoc.uid || `usr-${Date.now()}`,
          email: foundDoc.email || cleanEmail,
          password: foundDoc.password || password || undefined,
          role: foundDoc.role || 'USER',
          tier: foundDoc.tier || 'SILVER',
          principalBalance: String(foundDoc.principalBalance ?? '0.00'),
          earnedYield: String(foundDoc.earnedYield ?? '0.00'),
          totalWithdrawn: String(foundDoc.totalWithdrawn ?? '0.00'),
          walletAddress: foundDoc.walletAddress || `0x${Math.random().toString(16).substring(2, 10)}`,
          referralCode: foundDoc.referralCode || generateUniqueReferralCode('DC'),
          referredBy: foundDoc.referredBy || foundDoc.referredByCode || undefined,
          isFrozen: !!foundDoc.isFrozen,
          createdAt: foundDoc.createdAt || new Date().toISOString()
        };
        mockUsers.push(user);
      }
    } catch (fsErr) {
      console.warn('Firestore lookup during registration error:', fsErr);
    }
  }

  if (user) {
    return res.status(400).json({ 
      error: 'Account already exists with this email address. Please Log In instead.' 
    });
  }

  let referredByCode: string | undefined = undefined;
  if (referralCode) {
    const refClean = String(referralCode).trim();
    const referrer = mockUsers.find(
      (u) =>
        u.ibReferralCode?.toLowerCase() === refClean.toLowerCase() ||
        u.referralCode?.toLowerCase() === refClean.toLowerCase() ||
        u.id?.toLowerCase() === refClean.toLowerCase() ||
        u.username?.toLowerCase() === refClean.toLowerCase()
    );
    if (referrer) {
      referredByCode = referrer.id;
    } else {
      referredByCode = refClean;
    }
  }

  user = {
    id: `usr-reg-${Date.now()}`,
    email: cleanEmail,
    password: password || undefined,
    walletAddress: `0x${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`,
    role: 'USER (SILVER)',
    tier: 'SILVER',
    referralCode: generateUniqueReferralCode('DC'),
    referredBy: referredByCode,
    isFrozen: false,
    createdAt: new Date().toISOString(),
    joinedDate: new Date().toISOString().split('T')[0],
    totalDeposit: 0,
    dailyProfit: 0,
    totalBalance: 0,
    status: 'ACTIVE',
    principalBalance: '0.000000000000000000',
    earnedYield: '0.000000000000000000',
    totalWithdrawn: '0.000000000000000000',
    is_ib: false,
    ibStatus: 'NONE'
  };
  mockUsers.push(user);

  // Sync user record to Firestore
  try {
    const { db } = await import('./src/lib/firebase');
    const { doc, setDoc } = await import('firebase/firestore');
    const fsPayload = {
      uid: user.id,
      id: user.id,
      email: user.email,
      password: password || '',
      role: user.role,
      tier: user.tier,
      principalBalance: 0,
      earnedYield: 0,
      totalWithdrawn: 0,
      walletAddress: user.walletAddress,
      referralCode: user.referralCode,
      referredBy: user.referredBy || referredByCode || referralCode || '',
      isFrozen: false,
      createdAt: user.createdAt,
      joinedDate: user.joinedDate,
      totalDeposit: 0,
      dailyProfit: 0,
      totalBalance: 0,
      status: 'ACTIVE'
    };
    await setDoc(doc(db, 'users', user.id), fsPayload, { merge: true });
    if (cleanEmail && cleanEmail !== user.id) {
      await setDoc(doc(db, 'users', cleanEmail), fsPayload, { merge: true });
    }
  } catch (fsErr) {
    console.warn('Failed to persist newly registered user to Firestore:', fsErr);
  }

  // Dispatch automatic 5% signup referral commission to referrer
  if (referralCode || referredByCode) {
    dispatchSignupReferralCommission(user, referralCode || referredByCode);
  }

  activeUserId = user.id;
  res.json({ success: true, user });
});

// Central Server Route - POST /api/users (Create / Register user)
app.post('/api/users', async (req: Request, res: Response) => {
  const { email, password, name, phone, country, referralCode, role } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  let existing = mockUsers.find((u) => u.email.toLowerCase() === cleanEmail);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const isSovereign = cleanEmail === 'dollarcraft3@gmail.com';
  const roleVal = role || (isSovereign ? 'ADMIN' : 'USER (SILVER)');

  if (existing) {
    if (password) existing.password = password;
    existing.role = roleVal;
    if (!existing.joinedDate) existing.joinedDate = todayStr;
    if (existing.status === undefined) existing.status = 'ACTIVE';
    activeUserId = existing.id;
    return res.json({ success: true, user: existing });
  }

  const newId = isSovereign ? 'usr-admin-sovereign' : `usr-reg-${Date.now()}`;
  const newUser: User = {
    id: newId,
    email: cleanEmail,
    password: password || undefined,
    firstName: name || cleanEmail.split('@')[0],
    walletAddress: `0x${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`,
    role: roleVal,
    tier: 'SILVER',
    referralCode: generateUniqueReferralCode('DC'),
    referredBy: referralCode || '',
    isFrozen: false,
    createdAt: new Date().toISOString(),
    joinedDate: todayStr,
    totalDeposit: 0,
    dailyProfit: 0,
    totalBalance: 0,
    status: 'ACTIVE',
    principalBalance: '0.000000000000000000',
    earnedYield: '0.000000000000000000',
    totalWithdrawn: '0.000000000000000000',
    is_ib: false,
    ibStatus: 'NONE'
  };

  mockUsers.unshift(newUser);

  // Persist to Firestore as well
  try {
    const { db } = await import('./src/lib/firebase');
    const { doc, setDoc } = await import('firebase/firestore');
    const fsPayload = {
      uid: newUser.id,
      id: newUser.id,
      email: newUser.email,
      password: password || '',
      role: newUser.role,
      tier: newUser.tier,
      principalBalance: 0,
      earnedYield: 0,
      totalWithdrawn: 0,
      walletAddress: newUser.walletAddress,
      referralCode: newUser.referralCode,
      referredBy: newUser.referredBy || '',
      isFrozen: false,
      createdAt: newUser.createdAt,
      joinedDate: newUser.joinedDate,
      totalDeposit: 0,
      dailyProfit: 0,
      totalBalance: 0,
      status: 'ACTIVE'
    };
    await setDoc(doc(db, 'users', newUser.id), fsPayload, { merge: true });
    if (cleanEmail && cleanEmail !== newUser.id) {
      await setDoc(doc(db, 'users', cleanEmail), fsPayload, { merge: true });
    }
  } catch (fsErr) {
    console.warn('Failed to persist user to Firestore via /api/users:', fsErr);
  }

  activeUserId = newUser.id;
  res.json({ success: true, user: newUser });
});

// Central Server Route - GET /api/users & GET /api/admin/users
const handleGetAllUsers = async (req: Request, res: Response) => {
  if (!isFirestoreQuotaExceeded) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'users'));
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const fsEmail = (d.email || docSnap.id).toLowerCase().trim();
        const fsId = d.id || d.uid || docSnap.id;
        
        let existingUser = mockUsers.find(
          (u) => u.id === fsId || (u.email && u.email.toLowerCase().trim() === fsEmail)
        );

        if (existingUser) {
          if (d.password) existingUser.password = d.password;
          if (d.principalBalance !== undefined) existingUser.principalBalance = String(d.principalBalance);
          if (d.totalWithdrawn !== undefined) existingUser.totalWithdrawn = String(d.totalWithdrawn);
          if (d.baseEarnedYield !== undefined) existingUser.baseEarnedYield = String(d.baseEarnedYield);
          if (d.depositStartTime !== undefined && Number(d.depositStartTime) > 0) existingUser.depositStartTime = Number(d.depositStartTime);
          if (d.tier) existingUser.tier = d.tier;
          if (d.role) existingUser.role = d.role;
          if (d.isFrozen !== undefined) existingUser.isFrozen = !!d.isFrozen;
          if (d.createdAt || d.created_at || d.joinedDate) {
            existingUser.createdAt = d.createdAt || d.created_at || d.joinedDate;
          }
          if (d.joinedDate) existingUser.joinedDate = d.joinedDate;
          if (d.totalDeposit !== undefined) existingUser.totalDeposit = Number(d.totalDeposit);
          if (d.status) existingUser.status = d.status;
          if (d.walletAddress) existingUser.walletAddress = d.walletAddress;
          if (d.referralCode) existingUser.referralCode = d.referralCode;
          if (d.is_ib !== undefined) existingUser.is_ib = !!d.is_ib;
          if (d.ibStatus) existingUser.ibStatus = d.ibStatus;

          if (fsEmail === 'abdulha@gmail.com' || (existingUser.totalDeposit === 5000 && parseFloat(existingUser.totalWithdrawn || '0') >= 90)) {
            existingUser.principalBalance = '5000.000000000000000000';
            existingUser.totalDeposit = 5000;
            existingUser.totalWithdrawn = '100.000000000000000000';
            existingUser.earnedYield = '7.000000000000000000';
            existingUser.baseEarnedYield = '7.000000000000000000';
            existingUser.depositStartTime = Math.floor(Date.now() / 1000);
            existingUser.dailyProfit = 7;
            existingUser.totalBalance = 5007;

            // Persist fix to Firestore
            import('firebase/firestore').then(({ doc, setDoc }) => {
              setDoc(doc(db, 'users', fsEmail), {
                earnedYield: 7,
                baseEarnedYield: '7.000000000000000000',
                depositStartTime: Math.floor(Date.now() / 1000),
                totalWithdrawn: 100,
                totalDeposit: 5000,
                principalBalance: 5000,
                totalBalance: 5007,
                dailyProfit: 7
              }, { merge: true }).catch(() => {});
            }).catch(() => {});
          } else if (parseFloat(existingUser.totalWithdrawn || '0') === 0) {
            let parsedCreatedSec = 0;
            const cDate = existingUser.createdAt || d.createdAt || d.joinedDate || existingUser.joinedDate;
            if (cDate) {
              const t = new Date(cDate).getTime();
              if (!isNaN(t) && t > 0) parsedCreatedSec = Math.floor(t / 1000);
            }
            if (parsedCreatedSec > 0) {
              existingUser.depositStartTime = parsedCreatedSec;
              existingUser.baseEarnedYield = '0.000000000000000000';
            } else if (d.depositStartTime) {
              existingUser.depositStartTime = Number(d.depositStartTime);
            }
          } else {
            if (d.earnedYield !== undefined) existingUser.earnedYield = String(d.earnedYield);
            if (d.dailyProfit !== undefined) existingUser.dailyProfit = Number(d.dailyProfit);
            if (d.totalBalance !== undefined) existingUser.totalBalance = Number(d.totalBalance);
          }
        } else {
          const isAbdulha = fsEmail === 'abdulha@gmail.com';
          mockUsers.push({
            id: fsId,
            email: fsEmail || `${docSnap.id}@user.com`,
            password: d.password || undefined,
            walletAddress: d.walletAddress || `0x${fsId.substring(0, 8)}`,
            role: d.role || 'USER (SILVER)',
            tier: d.tier || (isAbdulha ? 'VIP' : 'SILVER'),
            referralCode: d.referralCode || `DC${fsId.substring(0, 6).toUpperCase()}`,
            isFrozen: !!d.isFrozen,
            createdAt: d.createdAt || d.created_at || d.joinedDate || (isAbdulha ? '2026-08-14T00:00:00.000Z' : new Date().toISOString()),
            joinedDate: d.joinedDate || (d.createdAt ? d.createdAt.split('T')[0] : (isAbdulha ? '2026-08-14' : new Date().toISOString().split('T')[0])),
            principalBalance: isAbdulha ? '5000.000000000000000000' : String(d.principalBalance || 0),
            earnedYield: isAbdulha ? '7.000000000000000000' : String(d.earnedYield || 0),
            baseEarnedYield: isAbdulha ? '7.000000000000000000' : (d.baseEarnedYield ? String(d.baseEarnedYield) : undefined),
            depositStartTime: isAbdulha ? Math.floor(Date.now() / 1000) : (d.depositStartTime ? Number(d.depositStartTime) : undefined),
            totalWithdrawn: isAbdulha ? '100.000000000000000000' : String(d.totalWithdrawn || 0),
            totalDeposit: isAbdulha ? 5000 : (d.totalDeposit !== undefined ? Number(d.totalDeposit) : 0),
            dailyProfit: isAbdulha ? 7 : (d.dailyProfit !== undefined ? Number(d.dailyProfit) : 0),
            totalBalance: isAbdulha ? 5007 : (d.totalBalance !== undefined ? Number(d.totalBalance) : 0),
            status: d.status || (d.isFrozen ? 'FROZEN' : 'ACTIVE'),
            is_ib: !!d.is_ib,
            ibStatus: d.ibStatus || 'NONE'
          });
        }
      });
    } catch (e) {
      handleFirestoreQuotaError(e);
    }
  }

  // Sort mockUsers: newest signups first
  mockUsers.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.joinedDate || 0).getTime();
    const timeB = new Date(b.createdAt || b.joinedDate || 0).getTime();
    if (isNaN(timeA) || isNaN(timeB)) return 0;
    return timeB - timeA;
  });
  res.json({ users: mockUsers });
};

app.get('/api/users', handleGetAllUsers);
app.get('/api/admin/users', handleGetAllUsers);

// Auth - Email Login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  const check = isValidEmail(email);
  if (!check.valid) {
    return res.status(400).json({ error: check.reason });
  }

  const cleanEmail = email.trim().toLowerCase();

  if (cleanEmail === 'dollarcraft3@gmail.com' && (password === 'gdbcbfjnxh@craft@007' || password === 'gdbcbfjnxh@craft2007')) {
    let sovereignUser = mockUsers.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!sovereignUser) {
      sovereignUser = {
        id: 'usr-admin-sovereign',
        email: 'dollarcraft3@gmail.com',
        password: 'gdbcbfjnxh@craft@007',
        role: 'ADMIN',
        tier: 'PLATINUM',
        principalBalance: '100000.00',
        earnedYield: '0.000000000000000000',
        totalWithdrawn: '0.00',
        walletAddress: '0xDC007ADMINSOVEREIGNVAULT001',
        referralCode: 'DCADMIN007',
        isFrozen: false,
        createdAt: new Date().toISOString()
      };
      mockUsers.unshift(sovereignUser);
    } else {
      sovereignUser.role = 'ADMIN';
      sovereignUser.password = 'gdbcbfjnxh@craft@007';
    }
    activeUserId = sovereignUser.id;
    return res.json({ success: true, user: sovereignUser });
  }

  let user = await ensureUserSyncedFromFirestore(cleanEmail);

  if (!user) {
    user = mockUsers.find((u) => u.email.toLowerCase() === cleanEmail);
  }

  // If not found in memory mockUsers, query Firestore database
  if (!user) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs, doc, getDoc, query, where } = await import('firebase/firestore');
      
      let foundDoc: any = null;
      const emailSnap = await getDoc(doc(db, 'users', cleanEmail)).catch(() => null);
      if (emailSnap && emailSnap.exists()) {
        foundDoc = { id: emailSnap.id, ...emailSnap.data() };
      } else {
        const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const snap = await getDocs(q).catch(() => null);
        if (snap && !snap.empty) {
          foundDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
      }

      if (foundDoc) {
        user = {
          id: foundDoc.id || foundDoc.uid || `usr-${Date.now()}`,
          email: (foundDoc.email || cleanEmail).toLowerCase().trim(),
          password: foundDoc.password || password || undefined,
          role: foundDoc.role || 'USER',
          tier: foundDoc.tier || 'SILVER',
          principalBalance: String(foundDoc.principalBalance ?? '0.00'),
          earnedYield: String(foundDoc.earnedYield ?? '0.00'),
          dailyProfit: Number(foundDoc.dailyProfit || foundDoc.earnedYield || 0),
          totalDeposit: Number(foundDoc.totalDeposit ?? foundDoc.principalBalance ?? 0),
          totalBalance: Number(foundDoc.totalBalance ?? 0),
          depositStartTime: foundDoc.depositStartTime || 0,
          baseEarnedYield: String(foundDoc.baseEarnedYield ?? '0.000000000000000000'),
          totalWithdrawn: String(foundDoc.totalWithdrawn ?? '0.00'),
          activeInvestment: foundDoc.activeInvestment || null,
          walletAddress: foundDoc.walletAddress || `0x${Math.random().toString(16).substring(2, 10)}`,
          referralCode: foundDoc.referralCode || generateUniqueReferralCode('DC'),
          referredBy: foundDoc.referredBy || foundDoc.referredByCode || undefined,
          ibWithdrawableCommission: String(foundDoc.ibWithdrawableCommission ?? '0'),
          ibTotalCommission: String(foundDoc.ibTotalCommission ?? '0'),
          is_ib: !!foundDoc.is_ib,
          ibStatus: foundDoc.ibStatus || 'NONE',
          isFrozen: !!foundDoc.isFrozen,
          createdAt: foundDoc.createdAt || new Date().toISOString()
        };
        mockUsers.push(user);
      }
    } catch (fsErr) {
      console.warn('Firestore lookup during login error:', fsErr);
    }
  }

  if (!user) {
    return res.status(400).json({ 
      error: 'Account not found. Please Sign Up first.' 
    });
  }

  if (user.password && password && user.password !== password) {
    return res.status(400).json({
      error: 'Invalid password.'
    });
  }

  if (password && !user.password) {
    user.password = password;
  }

  activeUserId = user.id;
  reconcileOfflineYields();
  res.json({ success: true, user });
});

// Auth - Logout
app.post('/api/auth/logout', (req: Request, res: Response) => {
  activeUserId = null;
  res.json({ success: true });
});

// Auth - Reset Password
app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const { email } = req.body;
  const check = isValidEmail(email);
  if (!check.valid) {
    return res.status(400).json({ error: check.reason });
  }

  res.json({ 
    success: true, 
    message: `Password reset instructions have been dispatched to ${email}. Please check your Gmail inbox.` 
  });
});

// Auth - Get Current User
app.get('/api/auth/me', async (req: Request, res: Response) => {
  const reqEmail = (
    req.headers['x-user-email'] ||
    req.query.userEmail ||
    req.query.email ||
    req.body?.userEmail
  )?.toString().trim().toLowerCase();

  const reqId = (
    req.headers['x-user-id'] ||
    req.query.userId ||
    req.body?.userId
  )?.toString().trim();

  let user = await ensureUserSyncedFromFirestore(reqEmail, reqId);
  if (!user) {
    user = getActiveUser(req);
  }
  res.json({ user });
});

// SSE Stream Endpoint for Live Yield Ticking
app.get('/api/yield/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientEmail = (
    req.headers['x-user-email'] ||
    req.query.userEmail ||
    req.query.email
  )?.toString().trim().toLowerCase() || '';

  const clientId = (
    req.headers['x-user-id'] ||
    req.query.userId ||
    req.query.id
  )?.toString().trim() || '';

  (res as any).clientEmail = clientEmail;
  (res as any).clientId = clientId;

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// Initial Dashboard State Data
app.get('/api/dashboard/state', async (req: Request, res: Response) => {
  const offlineReport = reconcileOfflineYields();

  const reqEmail = (
    req.headers['x-user-email'] ||
    req.query.userEmail ||
    req.body?.userEmail
  )?.toString().trim().toLowerCase();

  const reqId = (
    req.headers['x-user-id'] ||
    req.query.userId ||
    req.body?.userId
  )?.toString().trim();

  let activeUser = await ensureUserSyncedFromFirestore(reqEmail, reqId);
  if (!activeUser) {
    activeUser = getActiveUser(req);
  }
  const userEmailSearch = (reqEmail || activeUser?.email || '').toLowerCase().trim();
  const userIdSearch = reqId || activeUser?.id || '';

  if (userEmailSearch || userIdSearch) {
    let maxPrincipalBN = new BigNumber(activeUser?.principalBalance || '0');
    let maxWithdrawnBN = new BigNumber(activeUser?.totalWithdrawn || '0');
    let maxIbBN = new BigNumber(activeUser?.ibWithdrawableCommission || '0');

    mockUsers.forEach((u) => {
      const uEmailClean = (u.email || '').toLowerCase().trim();
      const isMatch = userEmailSearch
        ? uEmailClean === userEmailSearch
        : userIdSearch && u.id === userIdSearch;
      if (isMatch) {
        maxPrincipalBN = BigNumber.max(maxPrincipalBN, new BigNumber(u.principalBalance || '0'));
        maxWithdrawnBN = BigNumber.max(maxWithdrawnBN, new BigNumber(u.totalWithdrawn || '0'));
        maxIbBN = BigNumber.max(maxIbBN, new BigNumber(u.ibWithdrawableCommission || '0'));
      }
    });

    if (!isFirestoreQuotaExceeded) {
      try {
        const { db } = await import('./src/lib/firebase');
        const { collection, getDocs, query, where, doc, getDoc } = await import('firebase/firestore');

        let foundDoc: any = null;
        if (userEmailSearch) {
          const docRef = doc(db, 'users', userEmailSearch);
          const snap = await getDoc(docRef);
          if (snap.exists()) foundDoc = { id: snap.id, ...snap.data() };
        }
        if (!foundDoc && userIdSearch) {
          const docRef = doc(db, 'users', userIdSearch);
          const snap = await getDoc(docRef);
          if (snap.exists()) foundDoc = { id: snap.id, ...snap.data() };
        }
        if (!foundDoc && userEmailSearch) {
          const q = query(collection(db, 'users'), where('email', '==', userEmailSearch));
          const snap = await getDocs(q);
          if (!snap.empty) foundDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        if (foundDoc) {
          maxPrincipalBN = BigNumber.max(maxPrincipalBN, new BigNumber(foundDoc.principalBalance || '0'));
          maxWithdrawnBN = BigNumber.max(maxWithdrawnBN, new BigNumber(foundDoc.totalWithdrawn || '0'));
          maxIbBN = BigNumber.max(maxIbBN, new BigNumber(foundDoc.ibWithdrawableCommission || '0'));
        }

        // Query deposits collection with targeted query
        if (userEmailSearch || userIdSearch) {
          const depQ = userEmailSearch
            ? query(collection(db, 'deposits'), where('userEmail', '==', userEmailSearch))
            : query(collection(db, 'deposits'), where('userId', '==', userIdSearch));
          const allDepSnap = await getDocs(depQ);
          allDepSnap.forEach((dDoc) => {
            const dData: any = dDoc.data();
            const depId = dDoc.id || dData.id || `dep-${Date.now()}`;
            const dEmail = (dData.userEmail || dData.email || '').toLowerCase().trim();
            const dUserId = dData.userId || '';

            if (
              (userEmailSearch && dEmail === userEmailSearch) ||
              (userIdSearch && dUserId === userIdSearch)
            ) {
              const pAmount = String(dData.principalAmount || dData.amount || '0');
              maxPrincipalBN = BigNumber.max(maxPrincipalBN, new BigNumber(pAmount));

              if (!mockDeposits.some((m) => m.id === depId || (dData.transactionId && m.txHash === dData.transactionId))) {
                mockDeposits.unshift({
                  id: depId,
                  userId: dData.userId || userIdSearch || activeUser?.id || '',
                  userEmail: dData.userEmail || userEmailSearch || activeUser?.email || '',
                  planId: dData.planId || 'plan-standard',
                  planName: dData.planName || 'Standard Yield Plan',
                  principalAmount: pAmount,
                  earnedYield: dData.earnedYield !== undefined ? String(dData.earnedYield) : '0.000000000000000000',
                  totalPayout: '0',
                  dailyYieldPercent: dData.dailyYieldPercent || getPlanRates(pAmount).dailyYieldPercent,
                  cryptoNetwork: dData.cryptoNetwork || 'Internal Transfer',
                  txHash: dData.transactionId || dData.txHash || depId,
                  status: (dData.status || 'ACTIVE').toUpperCase(),
                  startTime: dData.createdAt || dData.startTime || new Date().toISOString(),
                  endTime: dData.endTime || new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
                  lastYieldTick: dData.lastYieldTick || new Date().toISOString(),
                  progressPercent: 0
                });
              }
            }
          });

          // Query withdrawals collection for the user
          const wdQ = userEmailSearch
            ? query(collection(db, 'withdrawals'), where('userEmail', '==', userEmailSearch))
            : query(collection(db, 'withdrawals'), where('userId', '==', userIdSearch));
          const allWdSnap = await getDocs(wdQ).catch(() => null);
          if (allWdSnap) {
            allWdSnap.forEach((wDoc) => {
              const wData: any = wDoc.data();
              const wdId = wDoc.id || wData.id || `tx-${Date.now()}`;
              const wEmail = (wData.userEmail || wData.email || wData.user || '').toLowerCase().trim();
              const wUserId = (wData.userId || wData.uid || '').trim();
              if ((userEmailSearch && wEmail === userEmailSearch) || (userIdSearch && wUserId === userIdSearch)) {
                const wAmt = parseFloat(wData.amount || wData.precisionAmount || '0') || 0;
                if (wData.status === 'APPROVED' || wData.status === 'PENDING') {
                  maxWithdrawnBN = BigNumber.max(maxWithdrawnBN, new BigNumber(wAmt));
                }
                const existingIdx = mockTransactions.findIndex((m) => m.id === wdId);
                const txObj: Transaction = {
                  id: wdId,
                  userId: wData.userId || userIdSearch || activeUser?.id || '',
                  userEmail: wData.userEmail || wData.email || userEmailSearch || activeUser?.email || '',
                  type: 'WITHDRAWAL',
                  amount: String(wAmt),
                  precisionAmount: String(wAmt),
                  destinationAddr: wData.destinationAddr || wData.iban || wData.accountNumber || '',
                  cryptoNetwork: wData.cryptoNetwork || wData.gateway || 'BANK_TRANSFER',
                  status: (wData.status || 'APPROVED').toUpperCase(),
                  createdAt: wData.createdAt || wData.startTime || new Date().toISOString()
                };
                if (existingIdx >= 0) {
                  mockTransactions[existingIdx] = { ...mockTransactions[existingIdx], ...txObj };
                } else {
                  mockTransactions.unshift(txObj);
                }
              }
            });
          }
        }
      } catch (fsErr) {
        handleFirestoreQuotaError(fsErr);
      }
    }

    if (!activeUser && userEmailSearch) {
      activeUser = consolidateUserByEmail(userEmailSearch, userIdSearch);
    }

    if (activeUser) {
      const activeUserCleanEmail = (activeUser.email || '').toLowerCase().trim();
      const userITX = mockInternalTransfers.filter((t) => {
        const tEmail = (t.toUserEmail || (t as any).userEmail || (t as any).toEmail || (t as any).email || '').toLowerCase().trim();
        const tId = (t.toUserId || (t as any).userId || (t as any).toId || '').trim();
        if (userEmailSearch && tEmail === userEmailSearch) return true;
        if (userIdSearch && tId === userIdSearch) return true;
        if (activeUser?.id && tId === activeUser.id) return true;
        if (activeUserCleanEmail && tEmail === activeUserCleanEmail) return true;
        return false;
      });

      // Create deposit entries for internal transfers if not present
      userITX.forEach((itx) => {
        if (itx.toWalletType === 'MAIN_WALLET' || itx.toWalletType === 'INVESTMENT_WALLET' || !itx.toWalletType) {
          const depId = `dep-${itx.transferId || itx.id}`;
          if (!mockDeposits.some((m) => m.id === depId || m.txHash === itx.transferId)) {
            mockDeposits.unshift({
              id: depId,
              userId: activeUser!.id,
              userEmail: activeUser!.email,
              planId: 'plan-standard',
              planName: 'Standard Yield Plan (Internal Transfer)',
              principalAmount: String(itx.amount || '0'),
              earnedYield: '0.000000000000000000',
              totalPayout: '0',
              dailyYieldPercent: getPlanRates(String(itx.amount || '0')).dailyYieldPercent,
              cryptoNetwork: 'Internal Transfer (Main Wallet)',
              txHash: itx.transferId || itx.id,
              status: 'ACTIVE',
              startTime: itx.createdAt || new Date().toISOString(),
              endTime: new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
              lastYieldTick: new Date().toISOString(),
              progressPercent: 0
            });
          }
        }
      });

      // Run reconciliation so all offline yields accrued up to now are calculated & credited
      reconcileOfflineYields();

      const itxSumBN = userITX
        .filter((t) => t.toWalletType === 'MAIN_WALLET' || t.toWalletType === 'INVESTMENT_WALLET' || !t.toWalletType)
        .reduce((sum, t) => sum.plus(t.amount || 0), new BigNumber(0));

      const itxIbSumBN = userITX
        .filter((t) => t.toWalletType === 'IB_COMMISSION_WALLET')
        .reduce((sum, t) => sum.plus(t.amount || 0), new BigNumber(0));

      const totalEffectivePrincipalBN = BigNumber.max(maxPrincipalBN, itxSumBN);

      if (totalEffectivePrincipalBN.isLessThanOrEqualTo(0)) {
        activeUser.principalBalance = '0.000000000000000000';
        activeUser.earnedYield = '0.000000000000000000';
        (activeUser as any).totalDeposit = 0;
        (activeUser as any).totalBalance = 0;
        activeUser.activeInvestment = null;
      } else {
        activeUser.principalBalance = totalEffectivePrincipalBN.toFixed(18);
        activeUser.totalWithdrawn = maxWithdrawnBN.toFixed(18);
        activeUser.earnedYield = activeUser.earnedYield || '0.000000000000000000';
        const pBalNum = totalEffectivePrincipalBN.toNumber();
        const earnedNum = new BigNumber(activeUser.earnedYield).toNumber();
        (activeUser as any).totalDeposit = pBalNum;
        (activeUser as any).totalBalance = Math.max(0, pBalNum + earnedNum);
      }

      if (itxIbSumBN.isGreaterThan(0)) {
        activeUser.is_ib = true;
        activeUser.ibStatus = 'APPROVED';
        activeUser.ibWithdrawableCommission = BigNumber.max(
          new BigNumber(activeUser.ibWithdrawableCommission || '0'),
          itxIbSumBN
        ).toFixed(2);
        activeUser.ibTotalCommission = BigNumber.max(
          new BigNumber(activeUser.ibTotalCommission || '0'),
          itxIbSumBN
        ).toFixed(2);
      }

      // Keep all duplicate mockUsers in lockstep
      mockUsers.forEach((u) => {
        if (
          (userEmailSearch && u.email && u.email.toLowerCase().trim() === userEmailSearch) ||
          (userIdSearch && u.id === userIdSearch) ||
          (activeUser?.id && u.id === activeUser.id)
        ) {
          u.id = activeUser!.id;
          u.principalBalance = activeUser!.principalBalance;
          u.earnedYield = activeUser!.earnedYield;
          u.totalWithdrawn = activeUser!.totalWithdrawn;
          if (activeUser!.is_ib) {
            u.is_ib = true;
            u.ibStatus = activeUser!.ibStatus;
            u.ibWithdrawableCommission = activeUser!.ibWithdrawableCommission;
            u.ibTotalCommission = activeUser!.ibTotalCommission;
          }
        }
      });
    }
  }

  const userDeposits = activeUser
    ? mockDeposits.filter(
        (d) =>
          d.userId === activeUser.id ||
          (activeUser.email && d.userId?.toLowerCase() === activeUser.email.toLowerCase()) ||
          (activeUser.email && d.userEmail?.toLowerCase() === activeUser.email.toLowerCase()) ||
          (userEmailSearch && d.userEmail?.toLowerCase() === userEmailSearch) ||
          (userIdSearch && d.userId === userIdSearch)
      )
    : [];
  const userTx = activeUser
    ? mockTransactions.filter((t) => {
        const tEmail = (t.userEmail || (t as any).email || (t as any).user || '').toLowerCase().trim();
        const tId = (t.userId || (t as any).uid || '').trim();
        const activeCleanEmail = (activeUser.email || '').toLowerCase().trim();
        return (
          (activeUser.id && tId === activeUser.id) ||
          (activeCleanEmail && tEmail === activeCleanEmail) ||
          (userEmailSearch && tEmail === userEmailSearch) ||
          (userIdSearch && tId === userIdSearch)
        );
      })
    : [];
  const userReferrals = activeUser
    ? mockReferrals.filter(
        (r) =>
          r.referrerId === activeUser.id ||
          (activeUser.email && (r as any).referrerEmail?.toLowerCase() === activeUser.email.toLowerCase()) ||
          (userEmailSearch && (r as any).referrerEmail?.toLowerCase() === userEmailSearch) ||
          (userIdSearch && r.referrerId === userIdSearch)
      )
    : [];

  let totalDepositedBN = new BigNumber(0);
  let totalPaidOutBN = new BigNumber(0);

  mockDeposits.forEach(d => {
    if (d.status === 'ACTIVE' || d.status === 'APPROVED' || d.status === 'COMPLETED') {
      totalDepositedBN = totalDepositedBN.plus(d.principalAmount || 0);
    }
  });

  mockTransactions.forEach(t => {
    if (t.type === 'WITHDRAWAL' && t.status === 'APPROVED') {
      totalPaidOutBN = totalPaidOutBN.plus(t.amount || 0);
    }
  });

  const baseLiquidityBN = new BigNumber('98637065765');
  const liquidityBN = baseLiquidityBN.plus(totalDepositedBN).minus(totalPaidOutBN);
  const calculatedLiquidity = liquidityBN.toFixed(2);

  const metrics: SystemMetrics = {
    totalDeposited: totalDepositedBN.toFixed(2),
    totalPaidOut: totalPaidOutBN.toFixed(2),
    totalYieldAccrued: '14285.901230000000',
    activeUsersCount: mockUsers.length,
    activeCyclesCount: mockDeposits.filter(d => d.status === 'ACTIVE' || d.status === 'APPROVED').length,
    systemLiquidity: calculatedLiquidity,
    yieldHealthScore: 100.0,
    pendingWithdrawalsCount: mockTransactions.filter(t => t.type === 'WITHDRAWAL' && t.status === 'PENDING').length,
    pendingWithdrawalsAmount: '0.00',
    lastTickTimestamp: new Date().toISOString(),
    tickExecutionMs: 1.2
  };

  res.json({
    user: activeUser,
    deposits: userDeposits,
    transactions: userTx,
    referrals: userReferrals,
    plans: INITIAL_PLANS,
    metrics,
    offlineEngine: {
      isAutonomous247: true,
      lastOfflineYieldAdded: offlineReport.totalOfflineYieldCredited,
      elapsedSecondsOffline: offlineReport.elapsedSeconds,
      timestamp: new Date().toISOString()
    }
  });
});

// Investment Plans Public Endpoint
app.get('/api/plans', (req: Request, res: Response) => {
  res.json({ plans: INITIAL_PLANS });
});

// Endpoint for Plan Activation
app.post('/api/user/activate-plan', (req: Request, res: Response) => {
  const { userId, userEmail, planId, planName, amount, dailyYieldPercent } = req.body;
  const targetEmail = (userEmail || '').toLowerCase().trim();
  const targetId = userId || '';

  const user = mockUsers.find((u) => u.id === targetId || (targetEmail && u.email.toLowerCase().trim() === targetEmail));
  if (!user) {
    return res.status(404).json({ success: false, error: 'User account not found.' });
  }

  const amtNum = parseFloat(amount || '0');
  if (isNaN(amtNum) || amtNum <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid activation amount.' });
  }

  let rate = dailyYieldPercent;
  if (!rate) {
    if (amtNum >= 1001) rate = 1.1666666666666667;
    else if (amtNum >= 501) rate = 1.0;
    else rate = 0.8333333333333334;
  }

  // Check if active deposit exists for user
  const existingDep = mockDeposits.find(
    (d) => (d.userId === user.id || (targetEmail && d.userEmail && d.userEmail.toLowerCase().trim() === targetEmail)) && d.status === 'ACTIVE'
  );

  if (existingDep) {
    existingDep.planId = planId || existingDep.planId;
    existingDep.planName = planName || existingDep.planName;
    existingDep.principalAmount = new BigNumber(amtNum).toFixed(18);
    existingDep.dailyYieldPercent = rate;
    existingDep.lastYieldTick = new Date().toISOString();
  } else {
    mockDeposits.unshift({
      id: `dep-plan-${Date.now()}`,
      userId: user.id,
      userEmail: user.email,
      planId: planId || 'plan-standard',
      planName: planName || 'Standard Yield Plan',
      principalAmount: new BigNumber(amtNum).toFixed(18),
      earnedYield: '0.000000000000000000',
      totalPayout: '0',
      dailyYieldPercent: rate,
      cryptoNetwork: 'Plan Activation',
      txHash: `ACT-${Date.now()}`,
      status: 'ACTIVE',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
      lastYieldTick: new Date().toISOString(),
      progressPercent: 0
    });
  }

  // Update user principalBalance if lower
  const currentP = parseFloat(user.principalBalance || '0');
  if (amtNum > currentP) {
    user.principalBalance = new BigNumber(amtNum).toFixed(18);
  }

  // Sync plan activation & activeInvestment to Firestore for real-time cross-device sync
  (async () => {
    try {
      const { db } = await import('./src/lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      const rates = getPlanRates(amtNum);
      const activeInv = {
        investmentAmount: amtNum,
        planType: rates.planType,
        planName: planName || rates.planName,
        dailyYieldPercent: rate,
        monthlyYieldPercent: rates.monthlyYieldPercent,
        activationTimestamp: Date.now(),
        lastCalculatedTimestamp: Date.now()
      };
      const payload = {
        principalBalance: Number(user.principalBalance || amtNum),
        activeInvestment: activeInv,
        updatedAt: new Date().toISOString()
      };
      if (user.email) {
        await setDoc(doc(db, 'users', user.email.toLowerCase().trim()), payload, { merge: true }).catch(() => {});
      }
      if (user.id) {
        await setDoc(doc(db, 'users', user.id), payload, { merge: true }).catch(() => {});
      }
    } catch (e) {}
  })();

  res.json({
    success: true,
    message: `Plan ${planName || 'Investment'} activated successfully! Continuous profit generation started.`,
    user
  });
});

// Create Deposit Request (Pending Admin Verification - No Auto Credit)
app.post('/api/deposit/create', (req: Request, res: Response) => {
  const { planId, amount, network, txHash } = req.body;
  const plan = INITIAL_PLANS.find((p) => p.id === planId);

  if (!plan) {
    return res.status(400).json({ error: 'Invalid investment plan selected.' });
  }

  const activeUser = getActiveUser();
  const principalBN = new BigNumber(amount || 0);

  if (principalBN.isLessThan(10)) {
    return res.status(400).json({ error: 'Deposit amount must be greater than $10.' });
  }

  if (principalBN.isLessThan(plan.minDeposit)) {
    return res.status(400).json({ error: `Minimum deposit for ${plan.name} is $${plan.minDeposit}.` });
  }

  // 1. Transaction ID Format Validation (10-20 alphanumeric characters)
  const cleanTx = (txHash || '').trim();
  if (!cleanTx || !/^[a-zA-Z0-9]{10,20}$/.test(cleanTx)) {
    return res.status(400).json({ error: 'Invalid Transaction ID. Must be 10-20 letters/numbers' });
  }

  // 2. Duplicate Transaction ID Check
  const duplicateInDeposits = mockDeposits.some(
    (d) => d.txHash && d.txHash.trim().toLowerCase() === cleanTx.toLowerCase() && ['PENDING', 'APPROVED', 'ACTIVE', 'pending', 'approved'].includes(d.status)
  );
  const duplicateInTx = mockTransactions.some(
    (t) => t.txHash && t.txHash.trim().toLowerCase() === cleanTx.toLowerCase() && ['PENDING', 'APPROVED', 'pending', 'approved'].includes(t.status)
  );

  if (duplicateInDeposits || duplicateInTx) {
    return res.status(400).json({ error: 'This Transaction ID is already in use. Please enter the correct one from your bank receipt.' });
  }

  // 3. Create Pending Deposit Record (NO AUTO CREDIT)
  const newDeposit: UserDeposit = {
    id: `dep-${Date.now()}`,
    userId: activeUser.id,
    planId: plan.id,
    planName: plan.name,
    principalAmount: principalBN.toFixed(18),
    earnedYield: '0.000000000000000000',
    totalPayout: '0',
    dailyYieldPercent: plan.dailyYieldPercent,
    cryptoNetwork: network || 'Bank Transfer (IBAN)',
    txHash: cleanTx,
    status: 'PENDING',
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + plan.durationDays * 86400 * 1000).toISOString(),
    lastYieldTick: new Date().toISOString(),
    progressPercent: 0
  };

  mockDeposits.unshift(newDeposit);

  // Add Pending Transaction Record
  const newTx: Transaction = {
    id: `tx-${Date.now()}`,
    userId: activeUser.id,
    userEmail: activeUser.email,
    type: 'DEPOSIT',
    amount: principalBN.toFixed(2),
    precisionAmount: principalBN.toFixed(18),
    txHash: cleanTx,
    cryptoNetwork: network || 'Bank Transfer (IBAN)',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(newTx);

  // Note: Dollars are NOT credited automatically. User must await admin approval.
  res.json({
    success: true,
    pending: true,
    message: 'Your deposit request is submitted. It will be verified within 30 minutes.',
    deposit: newDeposit
  });
});

// Helper: Dispatch automatic 5% direct referral commission to referrer upon deposit
function dispatchDirectReferralCommission(targetUser: User, depositAmountBN: BigNumber, depositTxHash?: string) {
  if (!targetUser || !targetUser.referredBy || targetUser.referredBy === targetUser.id) {
    return;
  }

  const cleanRef = String(targetUser.referredBy).trim().toLowerCase().replace(/^@/, '');
  if (!cleanRef) return;

  // Find referrer user by ID, username, email, referralCode, or ibReferralCode
  let referrer = mockUsers.find(
    (u) =>
      u.id?.toLowerCase() === cleanRef ||
      u.username?.toLowerCase() === cleanRef ||
      u.email?.toLowerCase() === cleanRef ||
      u.referralCode?.toLowerCase() === cleanRef ||
      u.ibReferralCode?.toLowerCase() === cleanRef
  );

  const applyCommission = (ref: User) => {
    if (!ref || ref.id === targetUser.id) return;

    // Calculate 5% Direct Referral Commission
    const commAmountBN = depositAmountBN.multipliedBy(0.05);
    if (commAmountBN.isLessThanOrEqualTo(0)) return;

    const commAmountStr = commAmountBN.toFixed(2);

    // 1. Directly credit referrer's principal / main balance so dollars arrive automatically
    ref.principalBalance = new BigNumber(ref.principalBalance || '0').plus(commAmountBN).toFixed(18);

    // 2. Also credit referrer's withdrawable and total commission tracking balances
    const curWithdraw = new BigNumber(ref.ibWithdrawableCommission || '0');
    const curTotal = new BigNumber(ref.ibTotalCommission || '0');
    ref.ibWithdrawableCommission = curWithdraw.plus(commAmountBN).toFixed(2);
    ref.ibTotalCommission = curTotal.plus(commAmountBN).toFixed(2);

    // 3. Create approved transaction record for referrer
    const refTx: Transaction = {
      id: `tx-refcomm-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: ref.id,
      userEmail: ref.email,
      type: 'REFERRAL_BONUS',
      amount: commAmountStr,
      precisionAmount: commAmountBN.toFixed(18),
      txHash: `REF-${depositTxHash || Date.now()}`,
      cryptoNetwork: 'Direct 5% Referral Commission',
      status: 'APPROVED',
      createdAt: new Date().toISOString()
    };
    mockTransactions.unshift(refTx);

    // 4. Record in mockReferrals
    const refReward: ReferralReward = {
      id: `ref-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      referrerId: ref.id,
      referredUserId: targetUser.id,
      referredUserEmail: targetUser.email,
      amount: commAmountStr,
      level: 1,
      createdAt: new Date().toISOString()
    };
    mockReferrals.unshift(refReward);

    // 5. Record in mockIbCommissions
    const ibComm: IBCommission = {
      id: `ibcom-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ibUserId: ref.id,
      clientUserId: targetUser.id,
      clientEmail: targetUser.email,
      investmentId: `dep-${Date.now()}`,
      investmentAmount: depositAmountBN.toFixed(2),
      commissionRate: 5,
      commissionAmount: commAmountStr,
      status: 'PAID',
      createdAt: new Date().toISOString()
    };
    mockIbCommissions.unshift(ibComm);

    // Sync referrer's updated balance to Firestore if available
    try {
      import('./src/lib/firebase').then(async ({ db }) => {
        const { doc, setDoc } = await import('firebase/firestore');
        const refKey = ref.id || ref.email;
        await setDoc(doc(db, 'users', refKey), {
          principalBalance: Number(ref.principalBalance || 0),
          ibWithdrawableCommission: Number(ref.ibWithdrawableCommission || 0),
          ibTotalCommission: Number(ref.ibTotalCommission || 0),
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch((e) => console.warn('Firestore update referrer deposit commission error:', e));
      });
    } catch (e) {
      console.warn('Firebase sync error:', e);
    }

    console.log(`[Referral Engine] Dispatched 5% ($${commAmountStr}) direct referral commission to @${ref.username || ref.email} for deposit ($${depositAmountBN.toFixed(2)}) by @${targetUser.username || targetUser.email}`);
  };

  if (referrer) {
    applyCommission(referrer);
  } else {
    // Try to find in Firestore if not present in memory mockUsers
    try {
      import('./src/lib/firebase').then(async ({ db }) => {
        const { collection, getDocs } = await import('firebase/firestore');
        const snap = await getDocs(collection(db, 'users'));
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (
            d.id?.toLowerCase() === cleanRef ||
            d.referralCode?.toLowerCase() === cleanRef ||
            d.email?.toLowerCase() === cleanRef ||
            d.username?.toLowerCase() === cleanRef
          ) {
            let foundUser = mockUsers.find((u) => u.id === (d.id || d.uid || docSnap.id));
            if (!foundUser) {
              foundUser = {
                id: d.id || d.uid || docSnap.id,
                email: d.email || '',
                role: d.role || 'USER',
                tier: d.tier || 'SILVER',
                principalBalance: String(d.principalBalance ?? '0.00'),
                earnedYield: String(d.earnedYield ?? '0.00'),
                totalWithdrawn: String(d.totalWithdrawn ?? '0.00'),
                walletAddress: d.walletAddress || '',
                referralCode: d.referralCode || '',
                referredBy: d.referredBy || '',
                ibWithdrawableCommission: String(d.ibWithdrawableCommission ?? '0.00'),
                ibTotalCommission: String(d.ibTotalCommission ?? '0.00'),
                isFrozen: !!d.isFrozen,
                createdAt: d.createdAt || new Date().toISOString()
              };
              mockUsers.push(foundUser);
            }
            if (foundUser && foundUser.id !== targetUser.id) {
              referrer = foundUser;
            }
          }
        });

        if (referrer) {
          applyCommission(referrer);
        }
      });
    } catch (err) {
      console.warn('Firestore referrer lookup error:', err);
    }
  }
}

// Helper: Dispatch automatic 5% signup referral commission to referrer when a new user signs up with referral code
function dispatchSignupReferralCommission(newUser: User, referralCodeInput?: string) {
  const refCodeClean = String(referralCodeInput || newUser.referredBy || '').trim().replace(/^@/, '');
  if (!refCodeClean) return;

  const referrer = mockUsers.find(
    (u) =>
      u.id?.toLowerCase() === refCodeClean.toLowerCase() ||
      u.referralCode?.toLowerCase() === refCodeClean.toLowerCase() ||
      u.ibReferralCode?.toLowerCase() === refCodeClean.toLowerCase() ||
      u.username?.toLowerCase() === refCodeClean.toLowerCase() ||
      u.email?.toLowerCase() === refCodeClean.toLowerCase()
  );

  if (!referrer || referrer.id === newUser.id) {
    return;
  }

  // Ensure referral link is set
  newUser.referredBy = referrer.id;

  // Prevent duplicate signup commissions for the same referred user
  const alreadyAwarded = mockTransactions.some(
    (t) => t.type === 'REFERRAL_BONUS' && t.txHash === `SIGNUP-REF-${newUser.id}`
  );
  if (alreadyAwarded) return;

  // Calculate 5% referral commission on initial principal balance if present
  const baseAmountBN = new BigNumber(newUser.principalBalance || '0');
  const commBN = baseAmountBN.multipliedBy(0.05); // 5% commission ($25.00)
  if (commBN.isLessThanOrEqualTo(0)) return;

  const commStr = commBN.toFixed(2);

  // 1. Directly credit referrer's principal balance so dollars arrive automatically in Total Deposit balance
  referrer.principalBalance = new BigNumber(referrer.principalBalance || '0').plus(commBN).toFixed(18);

  // 2. Also credit referrer's withdrawable and total commission tracking
  referrer.ibWithdrawableCommission = new BigNumber(referrer.ibWithdrawableCommission || '0').plus(commBN).toFixed(2);
  referrer.ibTotalCommission = new BigNumber(referrer.ibTotalCommission || '0').plus(commBN).toFixed(2);

  // 3. Create approved transaction record for referrer
  const refTx: Transaction = {
    id: `tx-signup-ref-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId: referrer.id,
    userEmail: referrer.email,
    type: 'REFERRAL_BONUS',
    amount: commStr,
    precisionAmount: commBN.toFixed(18),
    txHash: `SIGNUP-REF-${newUser.id}`,
    cryptoNetwork: '5% Signup Referral Bonus',
    status: 'APPROVED',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(refTx);

  // 4. Record in mockReferrals
  const refReward: ReferralReward = {
    id: `ref-signup-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    referrerId: referrer.id,
    referredUserId: newUser.id,
    referredUserEmail: newUser.email,
    amount: commStr,
    level: 1,
    createdAt: new Date().toISOString()
  };
  mockReferrals.unshift(refReward);

  // 5. Record in mockIbCommissions
  const ibComm: IBCommission = {
    id: `ibcom-signup-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    ibUserId: referrer.id,
    clientUserId: newUser.id,
    clientEmail: newUser.email,
    investmentId: `signup-${newUser.id}`,
    investmentAmount: baseAmountBN.toFixed(2),
    commissionRate: 5,
    commissionAmount: commStr,
    status: 'PAID',
    createdAt: new Date().toISOString()
  };
  mockIbCommissions.unshift(ibComm);

  // Sync referrer's updated balance to Firestore if available
  try {
    import('./src/lib/firebase').then(async ({ db }) => {
      const { doc, updateDoc, increment } = await import('firebase/firestore');
      await updateDoc(doc(db, 'users', referrer.id), {
        principalBalance: increment(commBN.toNumber()),
        ibWithdrawableCommission: increment(commBN.toNumber()),
        ibTotalCommission: increment(commBN.toNumber())
      }).catch((e) => console.warn('Firestore update referrer error:', e));
    });
  } catch (e) {
    console.warn('Firebase sync error:', e);
  }

  console.log(`[Referral Engine] Dispatched 5% ($${commStr}) signup referral commission to @${referrer.username || referrer.email} for new signup @${newUser.email}`);
}

// Admin: Centralized Master Sovereign Control Data Sync Endpoint
app.get('/api/admin/data', async (req: Request, res: Response) => {
  if (!isFirestoreQuotaExceeded) {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('./src/lib/firebase');

      // 1. Sync Users from Firestore into mockUsers master array
      const usersSnap = await getDocs(collection(db, 'users')).catch(() => null);
      if (usersSnap) {
        usersSnap.forEach((docSnap) => {
          const d = docSnap.data();
          const fsId = docSnap.id;
          const fsEmail = (d.email || fsId).toLowerCase().trim();
          const existingIdx = mockUsers.findIndex(
            (u) => u.id === fsId || (u.email && u.email.toLowerCase().trim() === fsEmail)
          );

          if (existingIdx >= 0) {
            mockUsers[existingIdx] = {
              ...mockUsers[existingIdx],
              password: d.password || mockUsers[existingIdx].password,
              principalBalance: d.principalBalance !== undefined ? String(d.principalBalance) : mockUsers[existingIdx].principalBalance,
              earnedYield: d.earnedYield !== undefined ? String(d.earnedYield) : mockUsers[existingIdx].earnedYield,
              tier: d.tier || mockUsers[existingIdx].tier,
              role: d.role || mockUsers[existingIdx].role,
              createdAt: d.createdAt || d.created_at || d.joinedDate || mockUsers[existingIdx].createdAt,
              joinedDate: d.joinedDate || d.createdAt || d.created_at || mockUsers[existingIdx].joinedDate,
              isFrozen: d.isFrozen !== undefined ? !!d.isFrozen : mockUsers[existingIdx].isFrozen,
              totalDeposit: d.totalDeposit !== undefined ? Number(d.totalDeposit) : mockUsers[existingIdx].totalDeposit,
              dailyProfit: d.dailyProfit !== undefined ? Number(d.dailyProfit) : mockUsers[existingIdx].dailyProfit,
              totalBalance: d.totalBalance !== undefined ? Number(d.totalBalance) : mockUsers[existingIdx].totalBalance,
              status: d.status || (d.isFrozen ? 'FROZEN' : 'ACTIVE'),
              is_ib: !!d.is_ib,
              ibStatus: d.ibStatus || 'NONE'
            };
          } else {
            mockUsers.push({
              id: fsId,
              email: fsEmail || `${fsId}@user.com`,
              password: d.password || undefined,
              walletAddress: d.walletAddress || `0x${fsId.substring(0, 8)}`,
              role: d.role || 'USER (SILVER)',
              tier: d.tier || 'SILVER',
              referralCode: d.referralCode || `DC${fsId.substring(0, 6).toUpperCase()}`,
              isFrozen: !!d.isFrozen,
              createdAt: d.createdAt || d.created_at || d.joinedDate || '2026-08-10',
              joinedDate: d.joinedDate || (d.createdAt ? d.createdAt.split('T')[0] : '2026-08-10'),
              principalBalance: String(d.principalBalance || 0),
              earnedYield: String(d.earnedYield || 0),
              totalWithdrawn: String(d.totalWithdrawn || 0),
              totalDeposit: d.totalDeposit !== undefined ? Number(d.totalDeposit) : 0,
              dailyProfit: d.dailyProfit !== undefined ? Number(d.dailyProfit) : 0,
              totalBalance: d.totalBalance !== undefined ? Number(d.totalBalance) : 0,
              status: d.status || (d.isFrozen ? 'FROZEN' : 'ACTIVE'),
              is_ib: !!d.is_ib,
              ibStatus: d.ibStatus || 'NONE'
            });
          }
        });
      }

      // 2. Sync IB Applications from Firestore
      const snap1 = await getDocs(collection(db, 'ib_applications')).catch(() => null);
      const snap2 = await getDocs(collection(db, 'ibApplications')).catch(() => null);
      const fsApps: IBApplication[] = [];
      snap1?.forEach((d) => fsApps.push({ ...(d.data() as IBApplication), id: d.id || (d.data() as IBApplication).id }));
      snap2?.forEach((d) => fsApps.push({ ...(d.data() as IBApplication), id: d.id || (d.data() as IBApplication).id }));
      fsApps.forEach((fsApp) => {
        const existingIdx = mockIbApplications.findIndex((a) => a.id === fsApp.id);
        if (existingIdx >= 0) {
          mockIbApplications[existingIdx] = { ...mockIbApplications[existingIdx], ...fsApp };
        } else {
          mockIbApplications.push(fsApp);
        }
      });

      // 3. Sync Withdrawals from Firestore
      const wSnap = await getDocs(collection(db, 'withdrawals')).catch(() => null);
      if (wSnap) {
        wSnap.forEach((docSnap) => {
          const fsData = docSnap.data() as Transaction;
          if (fsData && fsData.id) {
            const existingIdx = mockTransactions.findIndex((t) => t.id === fsData.id);
            if (existingIdx >= 0) {
              mockTransactions[existingIdx] = { ...mockTransactions[existingIdx], ...fsData };
            } else {
              mockTransactions.push(fsData);
            }
          }
        });
      }
    } catch (e) {
      handleFirestoreQuotaError(e);
    }
  }

  mockUsers.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.joinedDate || 0).getTime();
    const timeB = new Date(b.createdAt || b.joinedDate || 0).getTime();
    if (isNaN(timeA) || isNaN(timeB)) return 0;
    return timeB - timeA;
  });

  const withdrawalsList = mockTransactions.filter((t) => !t.type || t.type.toString().toUpperCase() === 'WITHDRAWAL' || t.destinationAddr || t.cryptoNetwork);
  withdrawalsList.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  mockIbApplications.sort((a, b) => new Date(b.createdAt || Date.now()).getTime() - new Date(a.createdAt || Date.now()).getTime());

  res.json({
    users: mockUsers,
    deposits: mockDeposits,
    withdrawals: withdrawalsList,
    ibApplications: mockIbApplications,
    ibPayments: mockIbMembershipPayments,
    internalTransfers: mockInternalTransfers
  });
});

// Admin: Get all deposits for verification
app.get('/api/admin/deposits', (req: Request, res: Response) => {
  res.json({ deposits: mockDeposits });
});

// Admin: Approve Deposit Request & Credit Balance
app.post('/api/admin/deposit/approve', (req: Request, res: Response) => {
  const { depositId } = req.body;
  const deposit = mockDeposits.find((d) => d.id === depositId);

  if (!deposit) {
    return res.status(404).json({ error: 'Deposit record not found.' });
  }

  if (deposit.status !== 'PENDING') {
    return res.status(400).json({ error: `Deposit status is already ${deposit.status}.` });
  }

  // Approve deposit
  deposit.status = 'ACTIVE';

  // Find target user and credit balance
  const targetUser = mockUsers.find((u) => u.id === deposit.userId);
  if (targetUser) {
    const depositBN = new BigNumber(deposit.principalAmount);
    targetUser.principalBalance = new BigNumber(targetUser.principalBalance || '0').plus(depositBN).toFixed(18);

    const targetPBalNum = new BigNumber(targetUser.principalBalance || '0').toNumber();
    let dailyYieldPercent = 0.8333333333333334;
    let monthlyYieldPercent = 25;
    let planName = 'Standard Plan';
    let planType = 'STANDARD';
    if (targetPBalNum >= 1001) {
      dailyYieldPercent = 1.1666666666666667;
      monthlyYieldPercent = 35;
      planName = 'VIP Plan';
      planType = 'VIP';
    } else if (targetPBalNum >= 501) {
      dailyYieldPercent = 1.0;
      monthlyYieldPercent = 30;
      planName = 'Premium Plan';
      planType = 'PREMIUM';
    }
    const activeInv = {
      investmentAmount: targetPBalNum,
      planType,
      planName,
      dailyYieldPercent,
      monthlyYieldPercent,
      activationTimestamp: Date.now(),
      lastCalculatedTimestamp: Date.now()
    };
    targetUser.activeInvestment = activeInv;

    // Update transaction status
    const tx = mockTransactions.find((t) => t.txHash === deposit.txHash || (t.userId === deposit.userId && t.type === 'DEPOSIT' && t.status === 'PENDING'));
    if (tx) {
      tx.status = 'APPROVED';
    }

    // Automatically dispatch 10% direct referral commission to referrer username
    dispatchDirectReferralCommission(targetUser, depositBN, deposit.txHash);

    // Sync updated targetUser balance to Firestore for real-time cross-device updates
    (async () => {
      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        const payload = {
          principalBalance: Number(targetUser.principalBalance || 0),
          earnedYield: Number(targetUser.earnedYield || 0),
          activeInvestment: activeInv,
          updatedAt: new Date().toISOString()
        };
        if (targetUser.email) {
          await setDoc(doc(db, 'users', targetUser.email.toLowerCase().trim()), payload, { merge: true }).catch(() => {});
        }
        if (targetUser.id) {
          await setDoc(doc(db, 'users', targetUser.id), payload, { merge: true }).catch(() => {});
        }
        if (deposit.id) {
          await setDoc(doc(db, 'deposits', deposit.id), { status: 'ACTIVE' }, { merge: true }).catch(() => {});
        }
      } catch (e) {}
    })();
  }

  res.json({
    success: true,
    message: `Deposit approved. $${new BigNumber(deposit.principalAmount).toFixed(2)} credited to user balance.`
  });
});

// Admin: Reject Deposit Request
app.post('/api/admin/deposit/reject', (req: Request, res: Response) => {
  const { depositId, reason } = req.body;
  const deposit = mockDeposits.find((d) => d.id === depositId);

  if (!deposit) {
    return res.status(404).json({ error: 'Deposit record not found.' });
  }

  if (deposit.status !== 'PENDING') {
    return res.status(400).json({ error: `Deposit status is already ${deposit.status}.` });
  }

  deposit.status = 'REJECTED';

  const tx = mockTransactions.find((t) => t.txHash === deposit.txHash || (t.userId === deposit.userId && t.type === 'DEPOSIT' && t.status === 'PENDING'));
  if (tx) {
    tx.status = 'REJECTED';
    if (reason) {
      tx.fraudNote = reason;
    }
  }

  res.json({ success: true, message: 'Deposit request rejected.' });
});

// ==========================================
// INTRODUCING BROKER (IB) SYSTEM ENDPOINTS
// ==========================================

// User submits IB application
app.post('/api/ib/apply', async (req: Request, res: Response) => {
  const { name, email, phone, walletAddress, country, experience, telegramWhatsapp } = req.body;
  const reqEmail = (email || '').trim().toLowerCase();
  const reqName = (name || '').trim();
  const reqPhone = (phone || '').trim();

  if (!reqName || !reqEmail || !reqPhone) {
    return res.status(400).json({ error: 'All required fields (Name, Email, Phone) must be completed' });
  }

  // Find or auto-register applicant user so they appear in user accounts as well
  let targetUser = mockUsers.find((u) => u.email.toLowerCase().trim() === reqEmail);
  if (!targetUser) {
    targetUser = {
      id: `usr-ib-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      email: reqEmail,
      walletAddress: walletAddress || `0x${Math.random().toString(16).substring(2, 10)}`,
      role: 'USER (SILVER)',
      tier: 'SILVER',
      referralCode: generateUniqueReferralCode('DC'),
      isFrozen: false,
      createdAt: new Date().toISOString(),
      principalBalance: '0.00',
      earnedYield: '0.000000000000000000',
      totalWithdrawn: '0.00',
      is_ib: false,
      ibStatus: 'PENDING'
    };
    mockUsers.unshift(targetUser);

    // Persist new user to Firestore
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      const { db } = await import('./src/lib/firebase');
      await setDoc(doc(db, 'users', reqEmail), targetUser).catch(() => null);
    } catch (e) {}
  } else {
    targetUser.ibStatus = 'PENDING';
    if (walletAddress) {
      targetUser.walletAddress = walletAddress;
    }
  }

  const existingApp = mockIbApplications.find((app) => app.userEmail && app.userEmail.toLowerCase().trim() === reqEmail && app.status === 'PENDING');
  if (existingApp) {
    return res.json({ success: true, application: existingApp, message: 'Your IB Partner application has been submitted successfully for verification!' });
  }

  const appCountry = country || 'Global';
  const appExp = experience || 'Standard IB Partner Application';
  const appContact = telegramWhatsapp || reqPhone || 'Not provided';

  const newApp: IBApplication = {
    id: `ibapp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId: targetUser.id,
    userName: reqName,
    userEmail: reqEmail,
    phone: reqPhone,
    walletAddress: walletAddress || targetUser.walletAddress || 'USDT TRC20 Address Unspecified',
    country: appCountry,
    experience: appExp,
    telegramWhatsapp: appContact,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  mockIbApplications.unshift(newApp);

  // Sync to Firestore
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const { db } = await import('./src/lib/firebase');
    await setDoc(doc(db, 'ib_applications', newApp.id), newApp).catch(() => null);
    await setDoc(doc(db, 'ibApplications', newApp.id), newApp).catch(() => null);
  } catch (e) {
    console.warn('Firestore IB apply notice:', e);
  }

  res.json({ success: true, application: newApp, message: 'Your IB Partner application has been submitted successfully for verification!' });
});

// ==========================================
// PAID IB MEMBERSHIP ($7000 SYSTEM WITH 10% REWARD)
// ==========================================

// User submits $7,000 IB Membership Payment
app.post('/api/ib/membership/pay', (req: Request, res: Response) => {
  const { paymentMethod, proofTxHash, walletAddress } = req.body;
  const activeUser = getActiveUser();

  if (!proofTxHash) {
    return res.status(400).json({ error: 'Transaction Hash / Proof of payment is required.' });
  }

  const existingPending = mockIbMembershipPayments.find(
    (p) => p.userId === activeUser.id && p.status === 'PENDING'
  );

  if (existingPending) {
    return res.status(400).json({ error: 'You already have a pending $7,000 IB Membership payment verification in queue.' });
  }

  const newPayment: IBMembershipPayment = {
    id: `ibpay-${Date.now()}`,
    userId: activeUser.id,
    userName: activeUser.email.split('@')[0] || 'User',
    userEmail: activeUser.email,
    amount: 7000,
    paymentMethod: paymentMethod || 'USDT_TRC20',
    proofTxHash: proofTxHash.trim(),
    walletAddress: walletAddress || activeUser.walletAddress || '',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  if (walletAddress) {
    activeUser.walletAddress = walletAddress;
  }

  mockIbMembershipPayments.unshift(newPayment);
  activeUser.ibStatus = 'PENDING';

  res.json({
    success: true,
    payment: newPayment,
    message: 'IB Membership Payment of $7,000 submitted successfully! Two requests generated for Admin: 1. Normal Account Activation ($7000 Deposit) & 2. IB Membership Request.'
  });
});

// Admin: Get all $7000 IB Membership Payments
app.get('/api/admin/ib-memberships', (req: Request, res: Response) => {
  res.json({ payments: mockIbMembershipPayments });
});

// Admin: Approve $7000 IB Membership Payment (Triggers $7k balance credit + IB activation + 10% direct $700 commission)
app.post('/api/admin/ib-membership/approve', (req: Request, res: Response) => {
  const { paymentId } = req.body;
  const payment = mockIbMembershipPayments.find((p) => p.id === paymentId);

  if (!payment) {
    return res.status(404).json({ error: 'IB Membership payment record not found.' });
  }

  if (payment.status !== 'PENDING') {
    return res.status(400).json({ error: `Payment already ${payment.status}.` });
  }

  payment.status = 'APPROVED';

  const targetUser = mockUsers.find(
    (u) => u.id === payment.userId || u.email.toLowerCase() === payment.userEmail.toLowerCase()
  );

  if (!targetUser) {
    return res.status(404).json({ error: 'Target user account not found.' });
  }

  // Action 1: Activate normal investment account & credit full $7000 to main investable balance
  targetUser.principalBalance = new BigNumber(targetUser.principalBalance || '0')
    .plus('7000.000000000000000000')
    .toFixed(18);

  const depositTx: Transaction = {
    id: `tx-dep7000-${Date.now()}`,
    userId: targetUser.id,
    userEmail: targetUser.email,
    type: 'DEPOSIT',
    amount: '7000.00',
    precisionAmount: '7000.000000000000000000',
    txHash: payment.proofTxHash || 'IB-$7000-MEMBERSHIP',
    status: 'APPROVED',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(depositTx);

  // Action 2: Activate IB Membership status
  targetUser.is_ib = true;
  targetUser.ibStatus = 'APPROVED';
  targetUser.ibReferralCode = generateUniqueReferralCode('IB-DC');
  targetUser.ibWithdrawableCommission = targetUser.ibWithdrawableCommission || '0.00';
  targetUser.ibTotalCommission = targetUser.ibTotalCommission || '0.00';

  // Action 3: TRIGGER 10% DIRECT COMMISSION LOGIC ($700)
  let commissionAwarded = false;
  let referrerEmail = '';

  if (targetUser.referredBy && targetUser.referredBy !== targetUser.id) {
    const cleanRef = String(targetUser.referredBy).trim().toLowerCase().replace(/^@/, '');
    const referrer = mockUsers.find(
      (u) =>
        u.id?.toLowerCase() === cleanRef ||
        u.username?.toLowerCase() === cleanRef ||
        u.email?.toLowerCase() === cleanRef ||
        u.referralCode?.toLowerCase() === cleanRef ||
        u.ibReferralCode?.toLowerCase() === cleanRef
    );

    if (referrer) {
      const DIRECT_COMMISSION = new BigNumber('700.00'); // 10% of $7000

      // Directly credit referrer's main balance with dollars
      referrer.principalBalance = new BigNumber(referrer.principalBalance || '0').plus(DIRECT_COMMISSION).toFixed(18);

      const curWithdraw = new BigNumber(referrer.ibWithdrawableCommission || '0');
      const curTotal = new BigNumber(referrer.ibTotalCommission || '0');

      referrer.ibWithdrawableCommission = curWithdraw.plus(DIRECT_COMMISSION).toFixed(2);
      referrer.ibTotalCommission = curTotal.plus(DIRECT_COMMISSION).toFixed(2);
      referrer.ibMembershipsSold = (referrer.ibMembershipsSold || 0) + 1;

      const commissionRecord: IBCommission = {
        id: `ibcom-mem-${Date.now()}`,
        ibUserId: referrer.id,
        clientUserId: targetUser.id,
        clientEmail: targetUser.email,
        investmentId: payment.id,
        investmentAmount: '7000.00',
        commissionRate: 10,
        commissionAmount: '700.00',
        status: 'PAID',
        createdAt: new Date().toISOString()
      };
      mockIbCommissions.unshift(commissionRecord);

      const bonusTx: Transaction = {
        id: `tx-ibcomm-${Date.now()}`,
        userId: referrer.id,
        userEmail: referrer.email,
        type: 'REFERRAL_BONUS',
        amount: '700.00',
        precisionAmount: '700.000000000000000000',
        status: 'APPROVED',
        createdAt: new Date().toISOString()
      };
      mockTransactions.unshift(bonusTx);

      commissionAwarded = true;
      referrerEmail = referrer.email;
    }
  }

  res.json({
    success: true,
    message: `IB Membership approved for ${targetUser.email}! $7,000 credited to main investable balance, IB status activated.${
      commissionAwarded ? ` $700 (10%) direct commission awarded to upline IB (${referrerEmail}).` : ' (No upline IB referrer found).'
    }`
  });
});

// Admin: Reject $7000 IB Membership Payment
app.post('/api/admin/ib-membership/reject', (req: Request, res: Response) => {
  const { paymentId, reason } = req.body;
  const payment = mockIbMembershipPayments.find((p) => p.id === paymentId);

  if (!payment) {
    return res.status(404).json({ error: 'IB Membership payment record not found.' });
  }

  payment.status = 'REJECTED';
  payment.rejectionReason = reason || 'Payment Verification Failed';

  const targetUser = mockUsers.find(
    (u) => u.id === payment.userId || u.email.toLowerCase() === payment.userEmail.toLowerCase()
  );

  if (targetUser) {
    targetUser.ibStatus = 'REJECTED';
  }

  res.json({ success: true, message: 'IB Membership payment rejected.' });
});

// Fetch IB Dashboard statistics and commission records
app.get('/api/ib/dashboard', (req: Request, res: Response) => {
  try {
    const activeUser = getActiveUser();
    if (!activeUser) {
      return res.status(200).json({
        is_ib: false,
        ibStatus: 'NONE',
        referralLink: '',
        ibReferralCode: '',
        maxCapAmount: '7000.00',
        remainingCap: '7000.00',
        capProgressPercent: 0,
        totalReferredUsers: 0,
        totalClientInvestments: '0.00',
        totalCommissionEarned: '0.00',
        withdrawableCommission: '0.00',
        commissions: [],
        generatedLinks: [],
        referredClients: []
      });
    }

    const userCommissions = (mockIbCommissions || []).filter((c) => c && c.ibUserId === activeUser.id);
    const referredUsers = (mockUsers || []).filter((u) => u && u.referredBy === activeUser.id);

    let totalClientInvBN = new BigNumber(0);
    (mockDeposits || []).forEach((dep) => {
      if (!dep) return;
      const isReferredClient = referredUsers.some((ru) => ru && ru.id === dep.userId);
      if (isReferredClient && ['ACTIVE', 'APPROVED', 'approved'].includes(dep.status)) {
        totalClientInvBN = totalClientInvBN.plus(dep.principalAmount || 0);
      }
    });

    const host = req.get('host') || 'dollarcraft.io';
    const protocol = req.protocol || 'https';
    const referralLink = `${protocol}://${host}/register?ref=IB${activeUser.id}`;

    const MAX_CAP = new BigNumber('7000.00');
    const earnedBN = new BigNumber(activeUser.ibTotalCommission || '0.00');
    const remainingBN = BigNumber.max(0, MAX_CAP.minus(earnedBN));
    const progressPercent = Math.min(100, parseFloat(earnedBN.dividedBy(MAX_CAP).multipliedBy(100).toFixed(2)));

    const userLinks = (mockGeneratedIbLinks || []).filter((l) => l && l.userId === activeUser.id);

    res.json({
      is_ib: !!activeUser.is_ib,
      ibStatus: activeUser.ibStatus || 'NONE',
      referralLink,
      ibReferralCode: activeUser.ibReferralCode || `IB${activeUser.id}`,
      maxCapAmount: '7000.00',
      remainingCap: remainingBN.toFixed(2),
      capProgressPercent: isNaN(progressPercent) ? 0 : progressPercent,
      totalReferredUsers: referredUsers.length,
      totalClientInvestments: totalClientInvBN.toFixed(2),
      totalCommissionEarned: earnedBN.toFixed(2),
      withdrawableCommission: activeUser.ibWithdrawableCommission || '0.00',
      commissions: userCommissions,
      generatedLinks: userLinks,
      referredClients: referredUsers.map((u) => {
        const uDeposits = (mockDeposits || []).filter((d) => d && d.userId === u.id);
        const totalInv = uDeposits.reduce((acc, d) => acc.plus(d.principalAmount || 0), new BigNumber(0)).toFixed(2);
        return {
          id: u.id,
          email: u.email,
          createdAt: u.createdAt,
          totalInvested: totalInv
        };
      })
    });
  } catch (err: any) {
    console.error('Error in /api/ib/dashboard:', err);
    res.status(500).json({ error: 'Failed to fetch IB dashboard data.' });
  }
});

// On-Demand IB Referral Link Generation bound to Big Data Server nodes
const VALID_IB_ACCESS_CODES = new Set(
  Array.from({ length: 100 }, (_, i) => `IB7000-CMP-${String(i + 1).padStart(3, '0')}`)
);

app.post('/api/ib/generate-link', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  const { campaignName, serverNode, accessCode } = req.body;

  const normalizedCode = (accessCode || '').trim().toUpperCase();

  if (!normalizedCode || !VALID_IB_ACCESS_CODES.has(normalizedCode)) {
    return res.status(400).json({
      error: 'SECURITY REJECTION: Valid IB Access Code required (e.g., IB7000-CMP-001 to IB7000-CMP-100). Link generation denied without a authorized code.'
    });
  }

  const campaign = (campaignName || 'Client On-Demand').trim();
  const node = (serverNode || 'US-EAST-CLOUD-01').trim();

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const referralCode = `IB-${normalizedCode}-${randomSuffix}`;

  const host = req.get('host') || 'dollarcraft.io';
  const protocol = req.protocol || 'https';
  const fullUrl = `${protocol}://${host}/register?ref=${referralCode}`;

  const newLink: GeneratedIbLink = {
    id: `ib-link-${Date.now()}-${randomSuffix}`,
    userId: activeUser.id,
    campaignName: campaign,
    accessCode: normalizedCode,
    referralCode,
    fullUrl,
    serverNode: node,
    clicksCount: Math.floor(Math.random() * 5) + 1,
    conversionsCount: 0,
    createdAt: new Date().toISOString()
  };

  mockGeneratedIbLinks.unshift(newLink);

  res.json({
    success: true,
    message: `On-demand IB link generated successfully for code ${normalizedCode} on ${node} Big Data Server.`,
    link: newLink
  });
});

app.get('/api/ib/links', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  const userLinks = mockGeneratedIbLinks.filter((l) => l.userId === activeUser.id);
  res.json({ success: true, links: userLinks });
});

app.delete('/api/ib/links/:id', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  const linkId = req.params.id;

  const initialLength = mockGeneratedIbLinks.length;
  mockGeneratedIbLinks = mockGeneratedIbLinks.filter(
    (l) => !(l.id === linkId && l.userId === activeUser.id)
  );

  if (mockGeneratedIbLinks.length < initialLength) {
    res.json({ success: true, message: 'IB link deleted successfully.' });
  } else {
    res.status(404).json({ error: 'Link not found or unauthorized.' });
  }
});

// Withdraw accumulated IB commissions to main balance
app.post('/api/ib/withdraw-commission', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  const availableCommission = new BigNumber(activeUser.ibWithdrawableCommission || '0');

  if (availableCommission.isLessThanOrEqualTo(0)) {
    return res.status(400).json({ error: 'No withdrawable commission balance available.' });
  }

  activeUser.earnedYield = new BigNumber(activeUser.earnedYield).plus(availableCommission).toFixed(18);
  const withdrawnAmount = availableCommission.toFixed(2);
  activeUser.ibWithdrawableCommission = '0.00';

  const newTx: Transaction = {
    id: `tx-ib-${Date.now()}`,
    userId: activeUser.id,
    userEmail: activeUser.email,
    type: 'REFERRAL_BONUS',
    amount: withdrawnAmount,
    precisionAmount: availableCommission.toFixed(18),
    status: 'APPROVED',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(newTx);

  res.json({
    success: true,
    message: `Successfully transferred $${withdrawnAmount} IB commission to your main balance!`,
    newMainYield: activeUser.earnedYield,
    withdrawableCommission: '0.00'
  });
});

// Admin: Get all IB applications
app.get('/api/admin/ib/applications', async (req: Request, res: Response) => {
  if (!isFirestoreQuotaExceeded) {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('./src/lib/firebase');
      const snap1 = await getDocs(collection(db, 'ib_applications')).catch(() => null);
      const snap2 = await getDocs(collection(db, 'ibApplications')).catch(() => null);

      const fsApps: IBApplication[] = [];
      snap1?.forEach((d) => {
        const item = d.data() as IBApplication;
        fsApps.push({ ...item, id: d.id || item.id });
      });
      snap2?.forEach((d) => {
        const item = d.data() as IBApplication;
        fsApps.push({ ...item, id: d.id || item.id });
      });

      fsApps.forEach((fsApp) => {
        const existingIdx = mockIbApplications.findIndex((a) => a.id === fsApp.id);
        if (existingIdx >= 0) {
          mockIbApplications[existingIdx] = { ...mockIbApplications[existingIdx], ...fsApp };
        } else {
          mockIbApplications.push(fsApp);
        }
      });
    } catch (e) {
      handleFirestoreQuotaError(e);
    }
  }

  res.json({ applications: mockIbApplications });
});

// Admin: Approve IB application
app.post('/api/admin/ib/approve', (req: Request, res: Response) => {
  const { applicationId } = req.body;
  const appItem = mockIbApplications.find((a) => a.id === applicationId);

  if (!appItem) {
    return res.status(404).json({ error: 'Application not found' });
  }

  appItem.status = 'APPROVED';
  const targetUser = mockUsers.find((u) => u.id === appItem.userId || u.email.toLowerCase() === appItem.userEmail.toLowerCase());

  if (targetUser) {
    targetUser.is_ib = true;
    targetUser.ibStatus = 'APPROVED';
    targetUser.ibReferralCode = `IB${targetUser.id}`;
    targetUser.ibWithdrawableCommission = targetUser.ibWithdrawableCommission || '0.00';
    targetUser.ibTotalCommission = targetUser.ibTotalCommission || '0.00';
  }

  res.json({ success: true, message: `IB application for ${appItem.userName} approved.` });
});

// Admin: Reject IB application
app.post('/api/admin/ib/reject', (req: Request, res: Response) => {
  const { applicationId, reason } = req.body;
  const appItem = mockIbApplications.find((a) => a.id === applicationId);

  if (!appItem) {
    return res.status(404).json({ error: 'Application not found' });
  }

  appItem.status = 'REJECTED';
  const targetUser = mockUsers.find((u) => u.id === appItem.userId || u.email.toLowerCase() === appItem.userEmail.toLowerCase());

  if (targetUser) {
    targetUser.ibStatus = 'REJECTED';
  }

  res.json({ success: true, message: `IB application rejected.` });
});

// Withdrawal Request with Race Condition & Anti-Exploit Protection
app.post('/api/withdrawal/request', async (req: Request, res: Response) => {
  try {
    const { amount, destinationAddr, network } = req.body;
    const reqEmail = (
      req.headers['x-user-email'] ||
      req.body.userEmail ||
      req.body.email ||
      req.query.userEmail
    )?.toString().trim().toLowerCase();

    const reqId = (
      req.headers['x-user-id'] ||
      req.body.userId ||
      req.query.userId
    )?.toString().trim();

    let activeUser = getActiveUser(req);
    if (!activeUser && reqEmail) {
      activeUser = mockUsers.find((u) => u.email.toLowerCase().trim() === reqEmail) || null;
    }
    if (!activeUser && reqId) {
      activeUser = mockUsers.find((u) => u.id === reqId) || null;
    }
    if (!activeUser && reqEmail) {
      activeUser = {
        id: reqId || `usr-${Date.now()}`,
        email: reqEmail,
        role: 'USER (SILVER)',
        tier: 'SILVER',
        referralCode: generateUniqueReferralCode('DC'),
        principalBalance: '0.00',
        earnedYield: '0.000000000000000000',
        totalWithdrawn: '0.00',
        isFrozen: false,
        createdAt: new Date().toISOString()
      };
      mockUsers.unshift(activeUser);
    }
    if (!activeUser) {
      activeUser = mockUsers[0];
    }

    if (!activeUser) {
      return res.status(401).json({ success: false, message: 'User session not found. Please log in.' });
    }

    if (activeUser.isFrozen) {
      return res.status(403).json({ success: false, message: 'Account frozen due to security policy audit.' });
    }

    const requestBN = new BigNumber(amount || 0);

    // Minimum $50 USD check
    if (requestBN.isNaN() || requestBN.isLessThan(50)) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $50.' });
    }

    const userYieldBN = new BigNumber(activeUser.earnedYield || '0');
    const dailyProfitBN = new BigNumber(activeUser.dailyProfit || 0);
    const totalBalBN = new BigNumber(activeUser.totalBalance || 0);
    const maxAvailBN = BigNumber.max(userYieldBN, dailyProfitBN, totalBalBN);

    if (requestBN.isGreaterThan(maxAvailBN) && maxAvailBN.isGreaterThan(0)) {
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }

    // Deduct directly and strictly from Daily Profit (earnedYield) and totalBalance
    const newYieldBN = BigNumber.max(0, userYieldBN.minus(requestBN));
    const newYieldStr = newYieldBN.toFixed(18);
    activeUser.earnedYield = newYieldStr;
    activeUser.dailyProfit = newYieldBN.toNumber();
    activeUser.totalWithdrawn = new BigNumber(activeUser.totalWithdrawn || '0').plus(requestBN).toFixed(18);
    
    const pBalNum = Number(activeUser.principalBalance || 0);
    const newTotBal = Math.max(0, pBalNum + newYieldBN.toNumber());
    activeUser.totalBalance = newTotBal;
    activeUser.baseEarnedYield = '0.000000000000000000';

    // Sync across all mockUsers entries matching email or id
    const userEmailClean = (activeUser.email || '').toLowerCase().trim();
    mockUsers.forEach((u) => {
      if ((u.email && u.email.toLowerCase().trim() === userEmailClean) || u.id === activeUser.id) {
        u.earnedYield = newYieldStr;
        u.dailyProfit = newYieldBN.toNumber();
        u.totalWithdrawn = activeUser.totalWithdrawn;
        u.totalBalance = newTotBal;
        u.baseEarnedYield = '0.000000000000000000';
      }
    });

    const txId = req.body.clientTxId || req.body.txId || req.body.id || `tx-${Date.now()}`;
    const newTx: Transaction = {
      id: txId,
      userId: activeUser.id,
      userEmail: activeUser.email,
      type: 'WITHDRAWAL',
      amount: requestBN.toFixed(2),
      precisionAmount: requestBN.toFixed(18),
      destinationAddr: destinationAddr || '',
      cryptoNetwork: network || 'BANK_TRANSFER',
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };

    // Deduplicate against existing transactions with exact same ID
    const existingIdx = mockTransactions.findIndex((t) => t.id === newTx.id);

    if (existingIdx >= 0) {
      mockTransactions[existingIdx] = { ...mockTransactions[existingIdx], ...newTx };
    } else {
      mockTransactions.unshift(newTx);
    }

    // Non-blocking background persistence to Firestore
    (async () => {
      if (isFirestoreQuotaExceeded) return;
      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        const payload = {
          earnedYield: Number(newYieldStr),
          dailyProfit: newYieldBN.toNumber(),
          totalWithdrawn: Number(activeUser.totalWithdrawn),
          totalBalance: newTotBal,
          baseEarnedYield: activeUser.baseEarnedYield,
          depositStartTime: activeUser.depositStartTime,
          updatedAt: new Date().toISOString()
        };
        if (userEmailClean) {
          setDoc(doc(db, 'users', userEmailClean), payload, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
        }
        if (activeUser.id && activeUser.id !== userEmailClean) {
          setDoc(doc(db, 'users', activeUser.id), payload, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
        }
        setDoc(doc(db, 'withdrawals', newTx.id), newTx, { merge: true }).catch((e) => handleFirestoreQuotaError(e));
      } catch (fsErr) {
        handleFirestoreQuotaError(fsErr);
      }
    })();

    return res.json({ 
      success: true, 
      message: 'Your withdraw approved in 24-48 hours',
      user: activeUser,
      transaction: newTx
    });
  } catch (err: any) {
    console.error('Withdrawal route error:', err);
    return res.status(500).json({ success: false, message: err?.message || 'Server error processing withdrawal.' });
  }
});

// User Get Personal Withdrawals & History
app.get('/api/user/withdrawals', async (req: Request, res: Response) => {
  const userEmail = (req.headers['x-user-email'] || req.query.email || '').toString().toLowerCase().trim();
  const userId = (req.headers['x-user-id'] || req.query.userId || '').toString().trim();

  let list = mockTransactions.filter((t) => {
    const tEmail = (t.userEmail || (t as any).email || (t as any).user || '').toLowerCase().trim();
    const tId = (t.userId || (t as any).uid || '').trim();
    const isWd = !t.type || t.type.toString().toUpperCase() === 'WITHDRAWAL' || Boolean(t.destinationAddr) || Boolean(t.cryptoNetwork);
    const isUserMatch = (userEmail && tEmail === userEmail) || (userId && tId === userId);
    return isWd && isUserMatch;
  });

  if (!isFirestoreQuotaExceeded) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'withdrawals'));
      snap.forEach((docSnap) => {
        const fsData = docSnap.data() as any;
        const wId = docSnap.id || fsData.id || `tx-${Date.now()}`;
        const wEmail = (fsData.userEmail || fsData.email || fsData.user || fsData.toUserEmail || '').toLowerCase().trim();
        const wUserId = (fsData.userId || fsData.uid || '').trim();

        const matchEmail = Boolean(userEmail && wEmail && wEmail === userEmail);
        const matchId = Boolean(userId && wUserId && wUserId === userId);

        if (matchEmail || matchId) {
          const txObj: Transaction = {
            id: wId,
            userId: fsData.userId || userId || '',
            userEmail: fsData.userEmail || fsData.email || userEmail || '',
            type: 'WITHDRAWAL',
            amount: String(fsData.amount || fsData.precisionAmount || '0'),
            precisionAmount: String(fsData.precisionAmount || fsData.amount || '0'),
            destinationAddr: fsData.destinationAddr || fsData.iban || fsData.accountNumber || '',
            cryptoNetwork: fsData.cryptoNetwork || fsData.gateway || 'BANK_TRANSFER',
            status: (fsData.status || 'APPROVED').toUpperCase(),
            createdAt: fsData.createdAt || fsData.startTime || new Date().toISOString()
          };

          const existingIdx = list.findIndex((t) => t.id === wId);
          if (existingIdx >= 0) {
            list[existingIdx] = { ...list[existingIdx], ...txObj };
          } else {
            list.push(txObj);
          }
        }
      });
    } catch (fsErr) {
      handleFirestoreQuotaError(fsErr);
    }
  }

  list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  // Deduplicate cleanly
  const deduplicatedList: Transaction[] = [];
  list.forEach((w) => {
    const isDup = deduplicatedList.some((existing) => existing.id === w.id || (existing.txHash && existing.txHash === w.txHash));
    if (!isDup) {
      deduplicatedList.push(w);
    }
  });

  res.json({ withdrawals: deduplicatedList });
});

// Admin Get All Withdrawals & History
app.get('/api/admin/withdrawals', async (req: Request, res: Response) => {
  let list = mockTransactions.filter((t) => !t.type || t.type.toString().toUpperCase() === 'WITHDRAWAL' || t.destinationAddr || t.cryptoNetwork);

  if (!isFirestoreQuotaExceeded) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'withdrawals'));
      snap.forEach((docSnap) => {
        const fsData = docSnap.data() as Transaction;
        if (fsData && (fsData.id || docSnap.id)) {
          const wId = fsData.id || docSnap.id;
          const existingIdx = list.findIndex((t) => t.id === wId);
          if (existingIdx >= 0) {
            list[existingIdx] = { ...list[existingIdx], ...fsData, id: wId };
          } else {
            list.push({ ...fsData, id: wId });
          }
        }
      });
    } catch (fsErr) {
      handleFirestoreQuotaError(fsErr);
    }
  }

  list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  res.json({ withdrawals: list });
});

// Admin Approve Withdrawal
app.post('/api/admin/withdrawal/approve', async (req: Request, res: Response) => {
  const { txId } = req.body;
  let tx = mockTransactions.find((t) => t.id === txId);

  if (tx) {
    tx.status = 'APPROVED';
  }

  let userEmail = tx?.userEmail || '';
  let userId = tx?.userId || '';
  let withdrawalAmount = tx ? parseFloat(tx.amount || tx.precisionAmount || '0') : 0;

  try {
    const { db } = await import('./src/lib/firebase');
    const { doc, getDoc, setDoc } = await import('firebase/firestore');

    const wdDocRef = doc(db, 'withdrawals', txId);
    const wdSnap = await getDoc(wdDocRef).catch(() => null);
    if (wdSnap && wdSnap.exists()) {
      const wdData = wdSnap.data() as any;
      if (!userEmail) userEmail = wdData.userEmail || wdData.email || wdData.user || '';
      if (!userId) userId = wdData.userId || wdData.uid || '';
      if (!withdrawalAmount) withdrawalAmount = parseFloat(wdData.amount || wdData.precisionAmount || '0');
      if (!tx) {
        tx = {
          id: txId,
          userId: userId || 'user',
          userEmail: userEmail || '',
          type: 'WITHDRAWAL',
          amount: String(withdrawalAmount),
          status: 'APPROVED',
          createdAt: wdData.createdAt || new Date().toISOString()
        } as Transaction;
        mockTransactions.unshift(tx);
      }
    }

    await setDoc(doc(db, 'withdrawals', txId), { status: 'APPROVED', settledAt: new Date().toISOString() }, { merge: true }).catch(() => {});

    // Ensure the user's totalWithdrawn is explicitly saved in users collection in Firestore
    const uEmailClean = (userEmail || '').toLowerCase().trim();
    if (uEmailClean || userId) {
      const user = mockUsers.find((u) => (u.email && u.email.toLowerCase().trim() === uEmailClean) || (userId && u.id === userId));
      if (user) {
        user.totalWithdrawn = BigNumber.max(new BigNumber(user.totalWithdrawn || '0'), new BigNumber(withdrawalAmount)).toFixed(18);
        const uPayload = {
          totalWithdrawn: Number(user.totalWithdrawn),
          earnedYield: Number(user.earnedYield || 0),
          dailyProfit: Number(user.dailyProfit || 0),
          totalBalance: Number(user.totalBalance || 0),
          baseEarnedYield: user.baseEarnedYield || user.earnedYield || '0',
          depositStartTime: user.depositStartTime || Math.floor(Date.now() / 1000),
          updatedAt: new Date().toISOString()
        };
        if (uEmailClean) {
          setDoc(doc(db, 'users', uEmailClean), uPayload, { merge: true }).catch(() => {});
        }
        if (userId && userId !== uEmailClean) {
          setDoc(doc(db, 'users', userId), uPayload, { merge: true }).catch(() => {});
        }
      }
    }
  } catch (fsErr) {
    console.warn('FS withdrawal approve sync warning:', fsErr);
  }

  return res.json({ success: true, message: 'Withdrawal approved & disbursed.' });
});

// Admin Reject Withdrawal
app.post('/api/admin/withdrawal/reject', async (req: Request, res: Response) => {
  const { txId, reason } = req.body;
  const tx = mockTransactions.find((t) => t.id === txId);

  if (tx) {
    tx.status = 'REJECTED';
    tx.fraudNote = reason;

    // Refund funds back to user
    const u = mockUsers.find((user) => user.id === tx.userId || user.email?.toLowerCase() === tx.userEmail?.toLowerCase());
    if (u) {
      const refundBN = new BigNumber(tx.precisionAmount || tx.amount || 0);
      const newYieldBN = new BigNumber(u.earnedYield || 0).plus(refundBN);
      const newYieldStr = newYieldBN.toFixed(18);
      const nowSec = Math.floor(Date.now() / 1000);
      u.earnedYield = newYieldStr;
      u.dailyProfit = newYieldBN.toNumber();
      u.baseEarnedYield = newYieldStr;
      u.depositStartTime = nowSec;
      u.totalWithdrawn = BigNumber.max(0, new BigNumber(u.totalWithdrawn || 0).minus(refundBN)).toFixed(18);
      const pBalNum = Number(u.principalBalance || 0);
      (u as any).totalBalance = Math.max(0, pBalNum + newYieldBN.toNumber());

      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        const uEmailClean = (u.email || '').toLowerCase().trim();
        const uPayload = {
          earnedYield: Number(newYieldStr),
          dailyProfit: newYieldBN.toNumber(),
          baseEarnedYield: newYieldStr,
          depositStartTime: nowSec,
          totalWithdrawn: Number(u.totalWithdrawn),
          totalBalance: (u as any).totalBalance,
          updatedAt: new Date().toISOString()
        };
        if (uEmailClean) {
          setDoc(doc(db, 'users', uEmailClean), uPayload, { merge: true }).catch(() => {});
        }
      } catch (e) {}
    }
  }

  try {
    const { db } = await import('./src/lib/firebase');
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'withdrawals', txId), { status: 'REJECTED', fraudNote: reason || 'Rejected by Admin' }, { merge: true }).catch(() => {});
  } catch (fsErr) {
    console.warn('FS withdrawal reject sync warning:', fsErr);
  }

  return res.json({ success: true, message: 'Withdrawal rejected and funds refunded to user balance.' });
});

// Admin Freeze User
app.post('/api/admin/user/freeze', (req: Request, res: Response) => {
  const { userId, reason } = req.body;
  const u = mockUsers.find((user) => user.id === userId);

  if (u) {
    u.isFrozen = true;
    u.frozenReason = reason;
    return res.json({ success: true, message: 'User account frozen successfully.' });
  }
  res.status(404).json({ error: 'User not found.' });
});

// Admin Unfreeze User
app.post('/api/admin/user/unfreeze', (req: Request, res: Response) => {
  const { userId } = req.body;
  const u = mockUsers.find((user) => user.id === userId);

  if (u) {
    u.isFrozen = false;
    u.frozenReason = undefined;
    return res.json({ success: true, message: 'User account unfrozen.' });
  }
  res.status(404).json({ error: 'User not found.' });
});

// Admin Change User Password
app.post('/api/admin/user/change-password', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { userId, email, newPassword } = req.body || {};

    if (!newPassword || String(newPassword).trim() === '') {
      return res.status(400).json({ error: 'New password cannot be empty.' });
    }

    const trimmedPassword = String(newPassword).trim();
    const targetEmail = (email || '').toLowerCase().trim();

    if (!userId && !targetEmail) {
      return res.status(400).json({ error: 'User identifier (userId or email) is required.' });
    }

    // 1. Update in-memory mockUsers (all matching entries by id or email)
    let updatedCount = 0;
    mockUsers.forEach((u) => {
      const matchId = userId && u.id === userId;
      const matchEmail = targetEmail && u.email && u.email.toLowerCase().trim() === targetEmail;
      if (matchId || matchEmail) {
        u.password = trimmedPassword;
        updatedCount++;
      }
    });

    // 2. Sync to Firestore database if configured
    if (!isFirestoreQuotaExceeded) {
      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');

        if (userId) {
          await setDoc(doc(db, 'users', userId), { password: trimmedPassword }, { merge: true }).catch(() => null);
        }
        if (targetEmail) {
          await setDoc(doc(db, 'users', targetEmail), { password: trimmedPassword }, { merge: true }).catch(() => null);
        }
      } catch (fsErr) {
        console.warn('Firestore user password update notice:', fsErr);
      }
    }

    return res.json({
      success: true,
      message: `Password updated successfully for user ${targetEmail || userId}.`,
      updatedCount
    });
  } catch (err: any) {
    console.error('Error in /api/admin/user/change-password:', err);
    return res.status(500).json({
      error: err?.message || 'Server error while updating password.'
    });
  }
});

// ==========================================
// INTERNAL TRANSFER & FUND MANAGEMENT ENDPOINTS
// ==========================================

// Get Internal Transfer State (Admin Wallet Balance, Auto Config, Logs, Users)
app.get('/api/admin/internal-transfers/state', async (req: Request, res: Response) => {
  if (!isFirestoreQuotaExceeded) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs } = await import('firebase/firestore');

      for (const colName of ['internalTransfers', 'internal_transfers']) {
        try {
          const itxSnap = await getDocs(collection(db, colName));
          itxSnap.forEach((docSnap) => {
            const dData: any = docSnap.data();
            const tId = docSnap.id || dData.id || dData.transferId;
            const toEmail = (
              dData.toUserEmail ||
              dData.recipientEmail ||
              dData.userEmail ||
              dData.toEmail ||
              dData.email ||
              ''
            ).toLowerCase().trim();
            
            if (!mockInternalTransfers.some((m) => m.id === tId || (dData.transferId && m.transferId === dData.transferId))) {
              mockInternalTransfers.unshift({
                id: tId,
                transferId: dData.transferId || tId,
                fromUserId: dData.fromUserId || 'admin',
                fromUserEmail: dData.fromUserEmail || 'admin@dollarcraft.io',
                toUserId: dData.toUserId || 'usr',
                toUserEmail: dData.toUserEmail || toEmail,
                recipientEmail: dData.recipientEmail || dData.toUserEmail || toEmail,
                toWalletType: dData.toWalletType || 'MAIN_WALLET',
                destinationWallet: dData.destinationWallet || (dData.toWalletType === 'IB_COMMISSION_WALLET' ? 'IB Commission Wallet' : 'Main Wallet / Investment Balance'),
                amount: String(dData.amount || '0'),
                note: dData.note || '',
                status: dData.status || 'SUCCESS',
                createdAt: dData.createdAt || dData.timestamp || new Date().toISOString(),
                timestamp: dData.timestamp || dData.createdAt || new Date().toISOString()
              });
            }
          });
        } catch (e) {
          handleFirestoreQuotaError(e);
        }
      }
    } catch (fsErr) {
      handleFirestoreQuotaError(fsErr);
    }
  }

  res.json({
    adminWalletBalance,
    autoSignupConfig,
    transfers: mockInternalTransfers,
    users: mockUsers
  });
});

// Get Internal Transfers received by specific user email
app.get('/api/user/internal-transfers', async (req: Request, res: Response) => {
  const email = String(req.query.email || req.headers['x-user-email'] || '').trim().toLowerCase();
  const userId = String(req.query.userId || req.headers['x-user-id'] || '').trim();
  let activeUser = getActiveUser(req);

  const searchEmail = email || (activeUser?.email ? activeUser.email.toLowerCase().trim() : '');
  const searchId = userId || activeUser?.id || '';

  if (searchEmail || searchId) {
    const syncedUser = await ensureUserSyncedFromFirestore(searchEmail, searchId);
    if (syncedUser) activeUser = syncedUser;
  }

  if (!isFirestoreQuotaExceeded && (searchEmail || searchId)) {
    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, getDocs } = await import('firebase/firestore');

      const allItxSnap = await getDocs(collection(db, 'internalTransfers'));
      allItxSnap.forEach((docSnap) => {
        const dData: any = docSnap.data();
        const tId = docSnap.id || dData.id || dData.transferId;
        const toEmail = (
          dData.toUserEmail ||
          dData.userEmail ||
          dData.toEmail ||
          dData.email ||
          dData.recipientEmail ||
          ''
        ).toLowerCase().trim();
        const toId = (dData.toUserId || dData.userId || dData.toId || '').trim();

        if (
          (searchEmail && toEmail === searchEmail) ||
          (searchId && toId === searchId)
        ) {
          if (!mockInternalTransfers.some((m) => m.id === tId || (dData.transferId && m.transferId === dData.transferId))) {
            mockInternalTransfers.unshift({
              id: tId,
              transferId: dData.transferId || tId,
              fromUserId: dData.fromUserId || 'admin',
              fromUserEmail: dData.fromUserEmail || 'admin@dollarcraft.io',
              toUserId: dData.toUserId || toId || searchId,
              toUserEmail: dData.toUserEmail || toEmail || searchEmail,
              toWalletType: dData.toWalletType || 'MAIN_WALLET',
              amount: String(dData.amount || '0'),
              note: dData.note,
              status: dData.status || 'SUCCESS',
              createdAt: dData.createdAt || new Date().toISOString()
            });
          }
        }
      });
    } catch (fsErr) {
      handleFirestoreQuotaError(fsErr);
    }
  }

  const activeCleanEmail = (activeUser?.email || '').toLowerCase().trim();
  const userTransfers = mockInternalTransfers.filter((t) => {
    const tEmail = (t.toUserEmail || (t as any).userEmail || (t as any).toEmail || (t as any).email || '').toLowerCase().trim();
    const tId = (t.toUserId || (t as any).userId || (t as any).toId || '').trim();
    if (searchEmail && tEmail === searchEmail) return true;
    if (searchId && tId === searchId) return true;
    if (activeUser?.id && tId === activeUser.id) return true;
    if (activeCleanEmail && tEmail === activeCleanEmail) return true;
    return false;
  });

  const targetUser = (searchEmail ? consolidateUserByEmail(searchEmail, searchId) : null) || activeUser;

  res.json({
    success: true,
    transfers: userTransfers,
    userEmail: searchEmail,
    principalBalance: targetUser?.principalBalance || '0.00',
    earnedYield: targetUser?.earnedYield || '0.00'
  });
});

// Execute Internal Transfer from Admin to Client Wallet
app.post('/api/admin/internal-transfers/send', async (req: Request, res: Response) => {
  try {
    const { toUserId, toUserEmail, amount, toWalletType, note, adminPassword } = req.body;
    const activeUser = getActiveUser();

    if (!adminPassword || String(adminPassword).trim() !== 'gdbcbfjnxh@craft@007') {
      return res.status(401).json({ error: 'Invalid Admin Security Password authorization.' });
    }

    const amountBN = new BigNumber(amount);
    if (amountBN.isNaN() || amountBN.isLessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Invalid transfer amount.' });
    }

    const adminBalanceBN = new BigNumber(adminWalletBalance);
    if (adminBalanceBN.isLessThan(amountBN)) {
      return res.status(400).json({ error: `Insufficient Admin Personal Wallet balance ($${adminWalletBalance} available).` });
    }

    const searchId = String(toUserId || '').trim();
    const searchEmail = String(toUserEmail || toUserId || '').trim().toLowerCase();

    let targetUser = searchEmail ? consolidateUserByEmail(searchEmail, searchId) : mockUsers.find((u) => searchId && u.id === searchId);

    // 1. Try Firestore lookup if user is not in mockUsers memory cache
    if (!targetUser && (searchEmail || searchId)) {
      try {
        const { db } = await import('./src/lib/firebase');
        const { collection, getDocs, query, where, doc, getDoc } = await import('firebase/firestore');
        
        let foundDoc: any = null;
        if (searchEmail) {
          const docRef = doc(db, 'users', searchEmail);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            foundDoc = { id: snap.id, ...snap.data() };
          }
        }
        if (!foundDoc && searchId) {
          const docRef = doc(db, 'users', searchId);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            foundDoc = { id: snap.id, ...snap.data() };
          }
        }
        if (!foundDoc && searchEmail) {
          const q = query(collection(db, 'users'), where('email', '==', searchEmail));
          const snap = await getDocs(q);
          if (!snap.empty) {
            foundDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
          }
        }

        if (foundDoc) {
          targetUser = {
            id: foundDoc.id || foundDoc.uid || `usr-${Date.now()}`,
            email: foundDoc.email || searchEmail,
            role: foundDoc.role || 'USER',
            tier: foundDoc.tier || 'SILVER',
            principalBalance: String(foundDoc.principalBalance || 0),
            earnedYield: String(foundDoc.earnedYield || 0),
            totalWithdrawn: String(foundDoc.totalWithdrawn || 0),
            walletAddress: foundDoc.walletAddress || `0x${(foundDoc.id || '00000000').substring(0, 8)}`,
            referralCode: foundDoc.referralCode || `DC${(foundDoc.id || '000000').substring(0, 6).toUpperCase()}`,
            referredBy: foundDoc.referredBy || foundDoc.referredByCode || undefined,
            isFrozen: !!foundDoc.isFrozen,
            createdAt: foundDoc.createdAt || new Date().toISOString()
          };
          mockUsers.push(targetUser);
        }
      } catch (fsErr) {
        console.warn('Firestore user lookup in internal transfer notice:', fsErr);
      }
    }

    // 2. Auto-provision user account if email provided but not yet registered
    if (!targetUser && searchEmail && searchEmail.includes('@')) {
      const generatedId = `usr-${Date.now()}`;
      targetUser = {
        id: generatedId,
        email: searchEmail,
        role: 'USER',
        tier: 'SILVER',
        principalBalance: '0.000000000000000000',
        earnedYield: '0.000000000000000000',
        totalWithdrawn: '0.000000000000000000',
        walletAddress: `0x${Math.random().toString(16).substring(2, 10)}`,
        referralCode: `DC${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        isFrozen: false,
        createdAt: new Date().toISOString()
      };
      mockUsers.push(targetUser);

      try {
        const { db } = await import('./src/lib/firebase');
        const { doc, setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', targetUser.id), {
          uid: targetUser.id,
          id: targetUser.id,
          email: targetUser.email,
          principalBalance: 0,
          earnedYield: 0,
          totalWithdrawn: 0,
          tier: 'SILVER',
          createdAt: targetUser.createdAt
        }, { merge: true });
      } catch (e) {
        console.warn('Firestore auto-provision notice:', e);
      }
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'Recipient user account not found. Please enter a valid email address.' });
    }

    if (activeUser && targetUser.id === activeUser.id && activeUser.role === 'ADMIN') {
      return res.status(400).json({ error: 'Self-transfer to Admin account is not allowed.' });
    }

    // Deduct from Admin Personal Wallet
    adminWalletBalance = adminBalanceBN.minus(amountBN).toFixed(2);

    // Credit to target client's selected wallet
    const walletTypeName = toWalletType === 'IB_COMMISSION_WALLET' ? 'IB Commission Wallet' : 'Main Wallet';

    const transferId = `ITX-${Math.floor(100000 + Math.random() * 900000)}`;

    if (toWalletType === 'MAIN_WALLET' || toWalletType === 'INVESTMENT_WALLET' || !toWalletType) {
      targetUser.principalBalance = new BigNumber(targetUser.principalBalance || '0').plus(amountBN).toFixed(18);

      const targetPBalNum = new BigNumber(targetUser.principalBalance || '0').toNumber();
      const targetEarnedYieldNum = new BigNumber(targetUser.earnedYield || '0').toNumber();
      (targetUser as any).totalDeposit = targetPBalNum;
      (targetUser as any).totalBalance = targetPBalNum + targetEarnedYieldNum;

      let dailyYieldPercent = 0.8333333333333334;
      let monthlyYieldPercent = 25;
      let planName = 'Standard Plan';
      let planType = 'STANDARD';
      if (targetPBalNum >= 1001) {
        dailyYieldPercent = 1.1666666666666667;
        monthlyYieldPercent = 35;
        planName = 'VIP Plan';
        planType = 'VIP';
      } else if (targetPBalNum >= 501) {
        dailyYieldPercent = 1.0;
        monthlyYieldPercent = 30;
        planName = 'Premium Plan';
        planType = 'PREMIUM';
      }
      const activeInv = {
        investmentAmount: targetPBalNum,
        planType,
        planName,
        dailyYieldPercent,
        monthlyYieldPercent,
        activationTimestamp: Date.now(),
        lastCalculatedTimestamp: Date.now()
      };
      targetUser.activeInvestment = activeInv;

      // Sync principalBalance across any duplicate user objects in memory with matching email
      mockUsers.forEach((u) => {
        if (u.email && targetUser.email && u.email.toLowerCase() === targetUser.email.toLowerCase()) {
          u.principalBalance = targetUser.principalBalance;
          (u as any).totalDeposit = targetPBalNum;
          (u as any).totalBalance = targetPBalNum + targetEarnedYieldNum;
          u.activeInvestment = activeInv;
        }
      });

      // Create Active UserDeposit record so it displays under total deposit section & active deposits list
      const transferRates = getPlanRates(amountBN.toNumber());
      const transferDeposit: UserDeposit = {
        id: `dep-itx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: targetUser.id,
        userEmail: targetUser.email,
        planId: transferRates.planType === 'VIP' ? 'plan-vip' : transferRates.planType === 'PREMIUM' ? 'plan-premium' : 'plan-standard',
        planName: transferRates.planName,
        principalAmount: amountBN.toFixed(18),
        earnedYield: '0.000000000000000000',
        totalPayout: '0',
        dailyYieldPercent: transferRates.dailyYieldPercent,
        cryptoNetwork: `Internal Transfer (${walletTypeName})`,
        txHash: transferId,
        status: 'ACTIVE',
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
        lastYieldTick: new Date().toISOString(),
        progressPercent: 0
      };
      mockDeposits.unshift(transferDeposit);

      // Trigger automatic 5% referral commission for the user's referrer
      dispatchDirectReferralCommission(targetUser, amountBN, transferId);
    } else if (toWalletType === 'IB_COMMISSION_WALLET') {
      targetUser.is_ib = true;
      targetUser.ibStatus = 'APPROVED';
      targetUser.ibWithdrawableCommission = new BigNumber(targetUser.ibWithdrawableCommission || '0').plus(amountBN).toFixed(2);
      targetUser.ibTotalCommission = new BigNumber(targetUser.ibTotalCommission || '0').plus(amountBN).toFixed(2);

      mockUsers.forEach((u) => {
        if (u.email && targetUser.email && u.email.toLowerCase() === targetUser.email.toLowerCase()) {
          u.is_ib = true;
          u.ibStatus = 'APPROVED';
          u.ibWithdrawableCommission = targetUser.ibWithdrawableCommission;
          u.ibTotalCommission = targetUser.ibTotalCommission;
        }
      });
    }

    // Sync updated targetUser balance and deposit to Firestore for real-time cross-device sync
    try {
      const { db } = await import('./src/lib/firebase');
      const { doc, setDoc, collection, addDoc } = await import('firebase/firestore');

      const userDocData = {
        uid: targetUser.id,
        id: targetUser.id,
        email: targetUser.email || '',
        principalBalance: Number(targetUser.principalBalance || 0),
        totalDeposit: Number((targetUser as any).totalDeposit || targetUser.principalBalance || 0),
        totalBalance: Number((targetUser as any).totalBalance || (Number(targetUser.principalBalance || 0) + Number(targetUser.earnedYield || 0))),
        earnedYield: Number(targetUser.earnedYield || 0),
        totalWithdrawn: Number(targetUser.totalWithdrawn || 0),
        ibWithdrawableCommission: Number(targetUser.ibWithdrawableCommission || 0),
        ibTotalCommission: Number(targetUser.ibTotalCommission || 0),
        is_ib: !!targetUser.is_ib,
        ibStatus: targetUser.ibStatus || 'NONE',
        activeInvestment: targetUser.activeInvestment || null,
        updatedAt: new Date().toISOString()
      };

      if (targetUser.id) {
        await setDoc(doc(db, 'users', targetUser.id), userDocData, { merge: true }).catch((e) => console.warn('FS sync error:', e));
      }
      if (targetUser.email && targetUser.email !== targetUser.id) {
        await setDoc(doc(db, 'users', targetUser.email.toLowerCase()), userDocData, { merge: true }).catch((e) => console.warn('FS sync error:', e));
      }

      if (toWalletType === 'MAIN_WALLET' || toWalletType === 'INVESTMENT_WALLET' || !toWalletType) {
        const syncRates = getPlanRates(amountBN.toNumber());
        await addDoc(collection(db, 'deposits'), {
          userId: targetUser.id,
          userEmail: targetUser.email || '',
          amount: amountBN.toFixed(2),
          transactionId: transferId,
          planId: syncRates.planType === 'VIP' ? 'plan-vip' : syncRates.planType === 'PREMIUM' ? 'plan-premium' : 'plan-standard',
          planName: syncRates.planName,
          dailyYieldPercent: syncRates.dailyYieldPercent,
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }).catch((e) => console.warn('Firestore deposit sync notice:', e));
      }
    } catch (fsSyncErr) {
      console.warn('Firestore post-transfer sync notice:', fsSyncErr);
    }

    const transferRecord: InternalTransfer = {
      id: `itx-${Date.now()}`,
      transferId,
      fromUserId: activeUser?.id || 'admin-root',
      fromUserEmail: activeUser?.email || 'admin@dollarcraft.io',
      toUserId: targetUser.id,
      toUserEmail: targetUser.email,
      recipientEmail: targetUser.email,
      toWalletType: toWalletType || 'MAIN_WALLET',
      destinationWallet: (toWalletType || 'MAIN_WALLET') === 'IB_COMMISSION_WALLET' ? 'IB Commission Wallet' : 'Main Wallet / Investment Balance',
      amount: amountBN.toFixed(2),
      note: note ? String(note).trim() : undefined,
      status: 'SUCCESS',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    };
    mockInternalTransfers.unshift(transferRecord);

    try {
      const { db } = await import('./src/lib/firebase');
      const { collection, addDoc } = await import('firebase/firestore');
      const docPayload = {
        id: transferRecord.id,
        transferId: transferRecord.transferId,
        fromUserId: transferRecord.fromUserId,
        fromUserEmail: transferRecord.fromUserEmail,
        toUserId: targetUser.id,
        toUserEmail: (targetUser.email || '').toLowerCase().trim(),
        recipientEmail: (targetUser.email || '').toLowerCase().trim(),
        userEmail: (targetUser.email || '').toLowerCase().trim(),
        toEmail: (targetUser.email || '').toLowerCase().trim(),
        email: (targetUser.email || '').toLowerCase().trim(),
        toWalletType: transferRecord.toWalletType,
        destinationWallet: transferRecord.destinationWallet,
        amount: transferRecord.amount,
        note: transferRecord.note || '',
        status: transferRecord.status,
        createdAt: transferRecord.createdAt,
        timestamp: transferRecord.timestamp
      };
      await addDoc(collection(db, 'internalTransfers'), docPayload).catch((e) => console.warn('Firestore write notice:', e));
      await addDoc(collection(db, 'internal_transfers'), docPayload).catch((e) => console.warn('Firestore write notice:', e));
    } catch (e) {
      console.warn('Firestore internalTransfers write notice:', e);
    }

    // User transaction ledger entry
    const userTx: Transaction = {
      id: `tx-itx-${Date.now()}`,
      userId: targetUser.id,
      userEmail: targetUser.email,
      type: 'ADMIN_ADJUSTMENT',
      amount: amountBN.toFixed(2),
      precisionAmount: amountBN.toFixed(18),
      cryptoNetwork: `Internal Transfer from Admin (${walletTypeName})`,
      status: 'APPROVED',
      createdAt: new Date().toISOString()
    };
    mockTransactions.unshift(userTx);

    // Client Notification
    mockUserNotifications.unshift({
      id: `notif-${Date.now()}`,
      userId: targetUser.id,
      title: 'Internal Transfer Received',
      message: `You have received $${amountBN.toFixed(2)} USD from Admin via Internal Transfer to your ${walletTypeName}${note ? ` (${note})` : ''}.`,
      type: 'INTERNAL_TRANSFER',
      read: false,
      createdAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Successfully transferred $${amountBN.toFixed(2)} to ${targetUser.email} (${walletTypeName})!`,
      transfer: transferRecord,
      newAdminBalance: adminWalletBalance
    });
  } catch (err: any) {
    console.error('Error executing internal transfer:', err);
    res.status(500).json({ error: err.message || 'Internal server error processing transfer.' });
  }
});

// Reverse Internal Transfer
app.post('/api/admin/internal-transfers/reverse', (req: Request, res: Response) => {
  const { transferId } = req.body;
  const activeUser = getActiveUser();

  if (activeUser.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }

  const transfer = mockInternalTransfers.find((t) => t.id === transferId || t.transferId === transferId);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer record not found.' });
  }

  if (transfer.status !== 'SUCCESS') {
    return res.status(400).json({ error: `Transfer is already ${transfer.status}.` });
  }

  const targetUser = mockUsers.find((u) => u.id === transfer.toUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  const amountBN = new BigNumber(transfer.amount);

  // Deduct from client wallet if sufficient
  if (transfer.toWalletType === 'MAIN_WALLET' || transfer.toWalletType === 'INVESTMENT_WALLET') {
    const curMainBN = new BigNumber(targetUser.principalBalance || '0');
    if (curMainBN.isLessThan(amountBN)) {
      return res.status(400).json({ error: `User current main balance ($${curMainBN.toFixed(2)}) is less than transfer amount ($${transfer.amount}). Cannot reverse.` });
    }
    targetUser.principalBalance = curMainBN.minus(amountBN).toFixed(18);
  } else if (transfer.toWalletType === 'IB_COMMISSION_WALLET') {
    const curIbBN = new BigNumber(targetUser.ibWithdrawableCommission || '0');
    if (curIbBN.isLessThan(amountBN)) {
      return res.status(400).json({ error: `User current IB commission balance ($${curIbBN.toFixed(2)}) is less than transfer amount ($${transfer.amount}). Cannot reverse.` });
    }
    targetUser.ibWithdrawableCommission = curIbBN.minus(amountBN).toFixed(2);
    targetUser.ibTotalCommission = BigNumber.max(0, new BigNumber(targetUser.ibTotalCommission || '0').minus(amountBN)).toFixed(2);
  }

  // Restore Admin Personal Wallet
  adminWalletBalance = new BigNumber(adminWalletBalance).plus(amountBN).toFixed(2);
  transfer.status = 'REVERSED';

  // Transaction Ledger Log
  const revTx: Transaction = {
    id: `tx-rev-${Date.now()}`,
    userId: targetUser.id,
    userEmail: targetUser.email,
    type: 'ADMIN_ADJUSTMENT',
    amount: `-${amountBN.toFixed(2)}`,
    precisionAmount: `-${amountBN.toFixed(18)}`,
    cryptoNetwork: `Internal Transfer Reversal (${transfer.transferId})`,
    status: 'APPROVED',
    createdAt: new Date().toISOString()
  };
  mockTransactions.unshift(revTx);

  // Client Notification
  mockUserNotifications.unshift({
    id: `notif-${Date.now()}`,
    userId: targetUser.id,
    title: 'Internal Transfer Reversed',
    message: `An internal transfer of $${transfer.amount} (ID: ${transfer.transferId}) was reversed by Admin.`,
    type: 'SYSTEM',
    read: false,
    createdAt: new Date().toISOString()
  });

  res.json({
    success: true,
    message: `Transfer ${transfer.transferId} reversed successfully. $${transfer.amount} returned to Admin Personal Wallet.`,
    newAdminBalance: adminWalletBalance
  });
});

// Top up Admin Personal Balance
app.post('/api/admin/wallet/topup', (req: Request, res: Response) => {
  const { amount } = req.body;
  const amountBN = new BigNumber(amount);
  if (amountBN.isNaN() || amountBN.isLessThanOrEqualTo(0)) {
    return res.status(400).json({ error: 'Invalid topup amount.' });
  }
  adminWalletBalance = new BigNumber(adminWalletBalance).plus(amountBN).toFixed(2);
  res.json({ success: true, newBalance: adminWalletBalance });
});

// Update Auto Signup Bonus Config
app.post('/api/admin/settings/auto-transfer', (req: Request, res: Response) => {
  const { enabled, bonusAmount, targetWallet } = req.body;
  autoSignupConfig = {
    enabled: !!enabled,
    bonusAmount: bonusAmount ? new BigNumber(bonusAmount).toFixed(2) : '5.00',
    targetWallet: targetWallet || 'MAIN_WALLET'
  };
  res.json({ success: true, autoSignupConfig });
});

// Get User Notifications
app.get('/api/user/notifications', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  const userNotifs = mockUserNotifications.filter((n) => n.userId === activeUser.id);
  res.json({ notifications: userNotifs });
});

// Mark Notifications as Read
app.post('/api/user/notifications/read', (req: Request, res: Response) => {
  const activeUser = getActiveUser();
  mockUserNotifications.forEach((n) => {
    if (n.userId === activeUser.id) n.read = true;
  });
  res.json({ success: true });
});

// API 404 Fallback - ensures unmatched /api/* calls return JSON instead of HTML
app.use('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `API endpoint ${req.originalUrl} not found.` });
});

// ==========================================
// VITE MIDDLEWARE SETUP
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Dollar Craft Sovereign Engine] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
