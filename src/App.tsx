import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { User, UserDeposit, Transaction, ReferralReward, SystemMetrics, InvestmentPlan, ActiveInvestment } from './types';
import { BigNumber, formatCurrency, formatPrecision, calculateMicroYield, calculateYieldPerSecond, calculateServerTimestampYield, getPlanRates, reconcileUserOfflineYield, resolveCanonicalDepositStartTime } from './lib/yieldEngine';
import { Header } from './components/Header';
import { LiveBalanceTicker } from './components/LiveBalanceTicker';
import { ActiveCyclesTable } from './components/ActiveCyclesTable';
import { DepositModal } from './components/DepositModal';
import { WithdrawalModal } from './components/WithdrawalModal';
import { AdminPanel } from './components/AdminPanel';
import { MasterPlanModal } from './components/MasterPlanModal';
import { ReferralSystem } from './components/ReferralSystem';
import { AuthModal } from './components/AuthModal';
import { GmailIntegrationModal } from './components/GmailIntegrationModal';
import { DollarCraftDashboard } from './components/DollarCraftDashboard';
import { CustomerDashboardView } from './components/CustomerDashboardView';
import { IBApplicationModal } from './components/IBApplicationModal';
import { IBMembershipModal } from './components/IBMembershipModal';
import { IBDashboardView } from './components/IBDashboardView';
import { InternalTransferPanel } from './components/InternalTransferPanel';
import { AboutUsModal } from './components/AboutUsModal';
import { AboutUsView } from './components/AboutUsView';
import { ServicesModal } from './components/ServicesModal';
import { ContactModal } from './components/ContactModal';
import { IBPartnerFormModal } from './components/IBPartnerFormModal';
import { LegalModal } from './components/LegalModal';
import { LiveEarningsModal } from './components/LiveEarningsModal';
import { WelcomeIntro } from './components/WelcomeIntro';
import { Logo } from './components/Logo';
import { INITIAL_PLANS } from './data/mockData';
import { AccessDeniedModal } from './components/AccessDeniedModal';
import { 
  TrendingUp, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Clock, 
  ShieldCheck, 
  ShieldAlert,
  SlidersHorizontal,
  Zap,
  BarChart2,
  RefreshCw,
  Lock,
  Layers,
  History,
  Info
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('dollarcraft_active_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.email || parsed.id)) return parsed;
      }
    } catch (e) {}
    return null;
  });
  const [deposits, setDeposits] = useState<UserDeposit[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [referrals, setReferrals] = useState<ReferralReward[]>([]);
  const [plans, setPlans] = useState<InvestmentPlan[]>(INITIAL_PLANS);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Active Investment Object & Rate for Non-Stop Profit Engine
  const [microYieldPerSecond, setMicroYieldPerSecond] = useState<string>('0');
  const [activeInvestment, setActiveInvestment] = useState<ActiveInvestment | null>(() => {
    try {
      const savedUser = localStorage.getItem('dollarcraft_active_user');
      if (savedUser) {
        const pUser = JSON.parse(savedUser);
        if (pUser?.id) {
          const invKey = `dollarcraft_active_investment_${pUser.id}`;
          const rawInv = localStorage.getItem(invKey);
          if (rawInv) return JSON.parse(rawInv);
        }
      }
    } catch (e) {}
    return null;
  });

  // Reconcile offline non-stop yield calculation immediately upon page load / login
  useEffect(() => {
    if (!user) return;

    let inv = activeInvestment;
    if (!inv && user.id) {
      try {
        const invKey = `dollarcraft_active_investment_${user.id}`;
        const rawInv = localStorage.getItem(invKey);
        if (rawInv) {
          inv = JSON.parse(rawInv);
          setActiveInvestment(inv);
        }
      } catch (e) {}
    }

    const res = reconcileUserOfflineYield(user, inv);
    if (res.updatedInvestment) {
      setActiveInvestment(res.updatedInvestment);
      if (user.id) {
        localStorage.setItem(`dollarcraft_active_investment_${user.id}`, JSON.stringify(res.updatedInvestment));
      }
    }

    if (res.updatedUser && res.updatedUser.earnedYield !== user.earnedYield) {
      setUser(res.updatedUser);
      localStorage.setItem('dollarcraft_active_user', JSON.stringify(res.updatedUser));
    }
  }, [user?.id, user?.email]);

  // Ref counter for periodic cloud sync
  const fsSyncTickRef = React.useRef(0);

  // Live real-time second-by-second micro-accruals loop using absolute Server-Timestamp Formula
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      setUser((prevUser) => {
        if (!prevUser) return prevUser;

        const activeDepositSum = (deposits || []).reduce(
          (sum, d) => sum + (parseFloat(String(d?.principalAmount || (d as any)?.amount || '0')) || 0),
          0
        );
        const pBal = Math.max(parseFloat(prevUser.principalBalance || '0') || 0, activeDepositSum);
        const totalDep = Math.max(Number(prevUser.totalDeposit || 0), pBal, activeDepositSum);
        let currentInv = activeInvestment || prevUser.activeInvestment;

        // Zero Deposit Hard Guard: If totalDeposit <= 0, dailyProfit MUST be 0.0000 & totalBalance MUST be 0.0000
        if (totalDep <= 0) {
          if (microYieldPerSecond !== '0') {
            setMicroYieldPerSecond('0');
          }
          if (activeInvestment !== null) {
            setActiveInvestment(null);
          }
          if (prevUser.earnedYield !== '0.000000000000000000' || prevUser.totalBalance !== 0 || prevUser.totalDeposit !== 0 || prevUser.principalBalance !== '0.000000000000000000') {
            const zeroUser: User = {
              ...prevUser,
              totalDeposit: 0,
              principalBalance: '0.000000000000000000',
              earnedYield: '0.000000000000000000',
              totalBalance: 0,
              activeInvestment: null,
              depositStartTime: 0,
              baseEarnedYield: '0.000000000000000000'
            };
            try {
              localStorage.setItem('dollarcraft_active_user', JSON.stringify(zeroUser));
              if (prevUser.id) localStorage.setItem(`dollarcraft_accumulated_profit_${prevUser.id}`, '0.000000000000000000');
              if (prevUser.email) localStorage.setItem(`dollarcraft_accumulated_profit_${prevUser.email.toLowerCase().trim()}`, '0.000000000000000000');
            } catch (e) {}
            return zeroUser;
          }
          return prevUser;
        }

        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);

        const effectiveInvAmt = Math.max(totalDep, pBal);

        let parsedCreatedSec = 0;
        if (prevUser.createdAt) {
          const t = new Date(prevUser.createdAt).getTime();
          if (!isNaN(t) && t > 0) parsedCreatedSec = Math.floor(t / 1000);
        }

        const canonicalDepositStart = resolveCanonicalDepositStartTime(prevUser, currentInv, deposits);

        if (!currentInv && effectiveInvAmt > 0) {
          const rates = getPlanRates(effectiveInvAmt);
          currentInv = {
            investmentAmount: effectiveInvAmt,
            planType: rates.planType,
            planName: rates.planName,
            dailyYieldPercent: rates.dailyYieldPercent,
            monthlyYieldPercent: rates.monthlyYieldPercent,
            activationTimestamp: nowMs,
            lastCalculatedTimestamp: nowMs,
            depositStartTime: canonicalDepositStart
          };
          setActiveInvestment(currentInv);
        }

        if (!currentInv && effectiveInvAmt <= 0) return prevUser;

        const invAmt = parseFloat(String(currentInv?.investmentAmount || effectiveInvAmt || '0')) || effectiveInvAmt;
        if (invAmt <= 0) {
          if (microYieldPerSecond !== '0') setMicroYieldPerSecond('0');
          return prevUser;
        }

        // Server-Timestamp Based Accrual Engine Calculation (Anchored to canonical immutable deposit start)
        const depositStartSec = canonicalDepositStart;
        let baseYieldStr = prevUser.baseEarnedYield || '0.000000000000000000';
        const totalWithdrawnVal = prevUser.totalWithdrawn || '0';

        const monthlyYieldPercent = currentInv.monthlyYieldPercent || (totalDep >= 1001 ? 35 : (totalDep >= 501 ? 30 : 25));

        const yieldRes = calculateServerTimestampYield(
          totalDep,
          monthlyYieldPercent,
          depositStartSec,
          nowSec,
          baseYieldStr,
          totalWithdrawnVal
        );

        const yieldPerSec = yieldRes.yieldPerSecond;
        const prevEarnedBN = new BigNumber(prevUser.earnedYield || '0');
        const prevProfitBN = new BigNumber(prevUser.dailyProfit || '0');
        const baselineBN = BigNumber.max(prevEarnedBN, prevProfitBN);

        // Strict monotonic sequential progression: each second ticks forward by exact yieldPerSec minimum without jumping down or resetting
        let newEarnedBN = BigNumber.max(
          yieldRes.accumulatedProfit,
          baselineBN.plus(yieldPerSec)
        );

        // Monotonic sequence: yield ticks up incrementally second by second
        const newEarnedStr = newEarnedBN.toFixed(18);
        const newTotalBal = Math.max(
          totalDep + newEarnedBN.toNumber(),
          0
        );

        setMicroYieldPerSecond(yieldPerSec.toFixed(18));

        const updatedInv: ActiveInvestment = {
          ...currentInv,
          lastCalculatedTimestamp: nowMs,
          depositStartTime: depositStartSec
        };
        setActiveInvestment(updatedInv);

        if (prevUser.id) {
          localStorage.setItem(`dollarcraft_active_investment_${prevUser.id}`, JSON.stringify(updatedInv));
          localStorage.setItem(`dollarcraft_last_updated_timestamp_${prevUser.id}`, String(nowMs));
          localStorage.setItem(`dollarcraft_accumulated_profit_${prevUser.id}`, newEarnedStr);
        }
        if (prevUser.email) {
          localStorage.setItem(`dollarcraft_accumulated_profit_${prevUser.email.toLowerCase().trim()}`, newEarnedStr);
        }

        // BIND DAILY PROFIT DIRECTLY TO REALTIME YIELD ACCRUAL
        const dailyProfitNum = newEarnedBN.toNumber();

        const updatedUser: User = {
          ...prevUser,
          earnedYield: newEarnedStr,
          totalBalance: newTotalBal,
          dailyProfit: dailyProfitNum,
          activeInvestment: updatedInv,
          depositStartTime: depositStartSec,
          baseEarnedYield: baseYieldStr
        };

        localStorage.setItem('dollarcraft_active_user', JSON.stringify(updatedUser));

        // Periodically sync accrued yield to Firestore cloud database (every 15 seconds)
        fsSyncTickRef.current++;
        if (fsSyncTickRef.current % 15 === 0 && prevUser.email) {
          const cleanEmail = prevUser.email.toLowerCase().trim();
          import('./lib/firebase').then(({ db, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError }) => {
            if (isClientFirestoreQuotaExceeded) return;
            import('firebase/firestore').then(({ doc, setDoc }) => {
              const payload = {
                earnedYield: Number(newEarnedStr),
                totalBalance: newTotalBal,
                dailyProfit: dailyProfitNum,
                principalBalance: Number(prevUser.principalBalance || 0),
                totalDeposit: totalDep,
                totalWithdrawn: Number(prevUser.totalWithdrawn || 0),
                activeInvestment: updatedInv,
                depositStartTime: depositStartSec,
                baseEarnedYield: baseYieldStr,
                lastCalculatedTimestamp: nowMs,
                updatedAt: new Date().toISOString()
              };
              setDoc(doc(db, 'users', cleanEmail), payload, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
              if (prevUser.id && prevUser.id !== cleanEmail) {
                setDoc(doc(db, 'users', prevUser.id), payload, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
              }
            }).catch((e) => handleClientFirestoreQuotaError(e));
          }).catch(() => {});
        }

        return updatedUser;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [user?.id, user?.email]);

  // Centralized Cloud Firestore Real-time Synchronization across PC and Mobile
  useEffect(() => {
    if (!user?.email && !user?.id) return;

    const cleanEmail = (user.email || '').trim().toLowerCase();
    const userId = user.id || '';

    let unsubEmail: (() => void) | null = null;
    let unsubId: (() => void) | null = null;

    (async () => {
      try {
        const { db, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError } = await import('./lib/firebase');
        if (isClientFirestoreQuotaExceeded) return;
        const { doc, onSnapshot } = await import('firebase/firestore');

        const handleDocUpdate = (d: any) => {
          if (!d) return;

          setUser((prevUser) => {
            if (!prevUser) return prevUser;

            const prevEmail = (prevUser.email || '').toLowerCase().trim();
            const docEmail = (d.email || d.userEmail || '').toLowerCase().trim();
            if (prevEmail && docEmail && prevEmail !== docEmail) {
              return prevUser;
            }

            const prevBalBN = new BigNumber(prevUser.principalBalance || '0');
            const prevDepBN = new BigNumber(prevUser.totalDeposit || '0');
            const fsBalBN = d.principalBalance !== undefined ? new BigNumber(d.principalBalance) : prevBalBN;
            const fsDepBN = d.totalDeposit !== undefined ? new BigNumber(d.totalDeposit) : prevDepBN;

            // Preserve non-zero balances using BigNumber.max so stale/uninitialized Firestore docs cannot reset user funds
            const effectiveBalBN = BigNumber.max(prevBalBN, fsBalBN);
            const effectiveDepBN = BigNumber.max(prevDepBN, fsDepBN, effectiveBalBN);
            const effectiveBalStr = effectiveBalBN.toFixed(18);
            const effectiveBalNum = effectiveBalBN.toNumber();
            const effectiveDepNum = effectiveDepBN.toNumber();

            const effectiveDepositStart = resolveCanonicalDepositStartTime(
              { ...prevUser, ...d },
              d.activeInvestment || prevUser.activeInvestment,
              deposits
            );
            let fsBaseYield = d.baseEarnedYield !== undefined && d.baseEarnedYield !== null
              ? String(d.baseEarnedYield)
              : (prevUser.baseEarnedYield || '0.000000000000000000');

            const nowSec = Math.floor(Date.now() / 1000);
            const fsWithdrawn = d.totalWithdrawn !== undefined ? String(d.totalWithdrawn) : (prevUser.totalWithdrawn || '0');

            if (!d.depositStartTime && cleanEmail) {
              import('./lib/firebase').then(({ db, isClientFirestoreQuotaExceeded }) => {
                if (isClientFirestoreQuotaExceeded) return;
                import('firebase/firestore').then(({ doc, setDoc }) => {
                  setDoc(doc(db, 'users', cleanEmail), { depositStartTime: effectiveDepositStart, baseEarnedYield: fsBaseYield }, { merge: true }).catch(() => {});
                });
              });
            }

            const monthlyRate = (d.activeInvestment?.monthlyYieldPercent) || (effectiveDepNum >= 1001 ? 35 : (effectiveDepNum >= 501 ? 30 : 25));
            const yieldRes = calculateServerTimestampYield(
              effectiveDepNum,
              monthlyRate,
              effectiveDepositStart,
              nowSec,
              fsBaseYield,
              fsWithdrawn
            );

            const prevEarnedBN = new BigNumber(prevUser.earnedYield || '0');
            const docEarnedBN = new BigNumber(d.earnedYield !== undefined ? d.earnedYield : (d.dailyProfit || '0'));
            const calculatedProfitBN = yieldRes.accumulatedProfit;
            
            // Strictly monotonic merge: never allow yield to decrease below what the user already accumulated
            const finalYieldBN = BigNumber.max(prevEarnedBN, docEarnedBN, calculatedProfitBN);
            const fsYieldStr = finalYieldBN.toFixed(18);

            const computedTotalBal = d.totalBalance !== undefined && Number(d.totalBalance) > 0
              ? Number(d.totalBalance)
              : Math.max(0, effectiveDepNum + finalYieldBN.toNumber());

            let updatedInv = prevUser.activeInvestment;
            if (effectiveBalNum <= 0) {
              updatedInv = null;
              setActiveInvestment(null);
            } else if (d.activeInvestment) {
              updatedInv = {
                investmentAmount: Math.max(Number(d.activeInvestment.investmentAmount || 0), effectiveBalNum),
                planType: d.activeInvestment.planType || (effectiveBalNum >= 1001 ? 'VIP' : (effectiveBalNum >= 501 ? 'PREMIUM' : 'STANDARD')),
                planName: d.activeInvestment.planName || (effectiveBalNum >= 1001 ? 'VIP Plan' : (effectiveBalNum >= 501 ? 'Premium Plan' : 'Standard Plan')),
                dailyYieldPercent: Number(d.activeInvestment.dailyYieldPercent || (effectiveBalNum >= 1001 ? 1.1666666666666667 : (effectiveBalNum >= 501 ? 1.0 : 0.8333333333333334))),
                monthlyYieldPercent: Number(d.activeInvestment.monthlyYieldPercent || (effectiveBalNum >= 1001 ? 35 : (effectiveBalNum >= 501 ? 30 : 25))),
                activationTimestamp: Number(d.activeInvestment.activationTimestamp || Date.now()),
                lastCalculatedTimestamp: Number(d.activeInvestment.lastCalculatedTimestamp || Date.now()),
                depositStartTime: effectiveDepositStart
              };
              setActiveInvestment(updatedInv);
            } else if (effectiveBalNum > 0) {
              const pBalNum = effectiveBalNum;
              let dailyYieldPercent = 0.8333333333333334;
              let monthlyYieldPercent = 25;
              let planName = 'Standard Plan';
              let planType = 'STANDARD';
              if (pBalNum >= 1001) {
                dailyYieldPercent = 1.1666666666666667;
                monthlyYieldPercent = 35;
                planName = 'VIP Plan';
                planType = 'VIP';
              } else if (pBalNum >= 501) {
                dailyYieldPercent = 1.0;
                monthlyYieldPercent = 30;
                planName = 'Premium Plan';
                planType = 'PREMIUM';
              }
              updatedInv = {
                investmentAmount: pBalNum,
                planType,
                planName,
                dailyYieldPercent,
                monthlyYieldPercent,
                activationTimestamp: Date.now(),
                lastCalculatedTimestamp: Date.now(),
                depositStartTime: effectiveDepositStart
              };
              setActiveInvestment(updatedInv);
            }

            const earnedYieldNum = parseFloat(fsYieldStr || '0') || 0;
            const totalDep = Math.max(effectiveDepNum, effectiveBalNum);

            if (totalDep <= 0) {
              const zeroUser: User = {
                ...prevUser,
                principalBalance: '0.000000000000000000',
                totalDeposit: 0,
                totalBalance: 0,
                earnedYield: '0.000000000000000000',
                totalWithdrawn: fsWithdrawn,
                ibWithdrawableCommission: d.ibWithdrawableCommission !== undefined ? String(d.ibWithdrawableCommission) : prevUser.ibWithdrawableCommission,
                ibTotalCommission: d.ibTotalCommission !== undefined ? String(d.ibTotalCommission) : prevUser.ibTotalCommission,
                is_ib: d.is_ib !== undefined ? !!d.is_ib : prevUser.is_ib,
                ibStatus: d.ibStatus || prevUser.ibStatus,
                isFrozen: d.isFrozen !== undefined ? !!d.isFrozen : prevUser.isFrozen,
                role: d.role || prevUser.role,
                tier: d.tier || prevUser.tier,
                activeInvestment: null,
                depositStartTime: 0,
                baseEarnedYield: '0.000000000000000000'
              };
              setActiveInvestment(null);
              setMicroYieldPerSecond('0');
              localStorage.setItem('dollarcraft_active_user', JSON.stringify(zeroUser));
              return zeroUser;
            }

            const totalBal = computedTotalBal;
            const computedDailyProfit = earnedYieldNum > 0 ? earnedYieldNum : yieldRes.accumulatedProfit.toNumber();

            const updatedUser: User = {
              ...prevUser,
              principalBalance: effectiveBalStr,
              totalDeposit: totalDep,
              totalBalance: totalBal,
              earnedYield: fsYieldStr,
              dailyProfit: computedDailyProfit,
              totalWithdrawn: fsWithdrawn,
              ibWithdrawableCommission: d.ibWithdrawableCommission !== undefined ? String(d.ibWithdrawableCommission) : prevUser.ibWithdrawableCommission,
              ibTotalCommission: d.ibTotalCommission !== undefined ? String(d.ibTotalCommission) : prevUser.ibTotalCommission,
              is_ib: d.is_ib !== undefined ? !!d.is_ib : prevUser.is_ib,
              ibStatus: d.ibStatus || prevUser.ibStatus,
              isFrozen: d.isFrozen !== undefined ? !!d.isFrozen : prevUser.isFrozen,
              role: d.role || prevUser.role,
              tier: d.tier || prevUser.tier,
              activeInvestment: updatedInv,
              depositStartTime: effectiveDepositStart,
              baseEarnedYield: fsBaseYield
            };

            localStorage.setItem('dollarcraft_active_user', JSON.stringify(updatedUser));
            if (updatedUser.id) {
              localStorage.setItem(`dollarcraft_active_investment_${updatedUser.id}`, JSON.stringify(updatedInv));
            }
            return updatedUser;
          });
        };

        if (cleanEmail) {
          const handleErr = (e: any) => {
            handleClientFirestoreQuotaError(e);
            queueMicrotask(() => {
              if (unsubEmail) { unsubEmail(); unsubEmail = null; }
            });
          };
          unsubEmail = onSnapshot(doc(db, 'users', cleanEmail), (snap) => {
            if (snap.exists()) handleDocUpdate(snap.data());
          }, handleErr);
        }

        if (userId && userId !== cleanEmail) {
          const handleErrId = (e: any) => {
            handleClientFirestoreQuotaError(e);
            queueMicrotask(() => {
              if (unsubId) { unsubId(); unsubId = null; }
            });
          };
          unsubId = onSnapshot(doc(db, 'users', userId), (snap) => {
            if (snap.exists()) handleDocUpdate(snap.data());
          }, handleErrId);
        }
      } catch (e) {
        console.warn('Realtime Firestore sync setup error:', e);
      }
    })();

    return () => {
      if (unsubEmail) unsubEmail();
      if (unsubId) unsubId();
    };
  }, [user?.email, user?.id]);

  // Real-time calculation variables for UI tick rate
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);

  // Theme State (Dark Mode vs High-Contrast Light Mode)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('dollarcraft_theme') as 'dark' | 'light') || 'dark';
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('dollarcraft_theme', next);
      return next;
    });
  };

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  // Auto-save user yield and balance to Firestore on tab hide, close, or unload
  useEffect(() => {
    if (!user || !user.email) return;

    const handleAutoSave = () => {
      const cleanEmail = (user.email || '').toLowerCase().trim();
      if (!cleanEmail) return;

      import('./lib/firebase').then(({ db, isClientFirestoreQuotaExceeded }) => {
        if (isClientFirestoreQuotaExceeded) return;
        import('firebase/firestore').then(({ doc, setDoc }) => {
          const payload = {
            earnedYield: Number(user.earnedYield || 0),
            totalBalance: Number(user.totalBalance || 0),
            dailyProfit: Number(user.dailyProfit || 0),
            depositStartTime: user.depositStartTime || Math.floor(Date.now() / 1000),
            baseEarnedYield: user.baseEarnedYield || '0.000000000000000000',
            principalBalance: Number(user.principalBalance || 0),
            totalDeposit: Number(user.totalDeposit || 0),
            updatedAt: new Date().toISOString()
          };
          setDoc(doc(db, 'users', cleanEmail), payload, { merge: true }).catch(() => {});
          if (user.id && user.id !== cleanEmail) {
            setDoc(doc(db, 'users', user.id), payload, { merge: true }).catch(() => {});
          }
        });
      }).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleAutoSave();
      } else if (document.visibilityState === 'visible') {
        if (user) {
          const res = reconcileUserOfflineYield(user, activeInvestment);
          if (res.updatedUser && res.updatedUser.earnedYield !== user.earnedYield) {
            setUser(res.updatedUser);
          }
          fetchState();
        }
      }
    };

    window.addEventListener('beforeunload', handleAutoSave);
    window.addEventListener('pagehide', handleAutoSave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleAutoSave);
      window.removeEventListener('pagehide', handleAutoSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  // Navigation & Modals
  const [activeTab, setActiveTab] = useState<string>('customer_dashboard');
  const [isDepositOpen, setIsDepositOpen] = useState<boolean>(false);
  const [selectedPlanForDeposit, setSelectedPlanForDeposit] = useState<string>('plan-standard');
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState<boolean>(false);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [isAccessDeniedOpen, setIsAccessDeniedOpen] = useState<boolean>(false);
  const [isMasterPlanOpen, setIsMasterPlanOpen] = useState<boolean>(false);

  useEffect(() => {
    if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
      if (user?.email?.toLowerCase() === 'dollarcraft3@gmail.com' || user?.role === 'ADMIN') {
        setActiveTab('admin');
        setIsAdminOpen(true);
      } else if (user) {
        setIsAccessDeniedOpen(true);
        setActiveTab('customer_dashboard');
      }
    }
  }, [user]);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(true);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');

  const handleOpenAuth = (mode: 'login' | 'signup' = 'login') => {
    setAuthInitialMode(mode);
    setIsAuthOpen(true);
  };
  const [isGmailModalOpen, setIsGmailModalOpen] = useState<boolean>(false);
  const [isIBApplyOpen, setIsIBApplyOpen] = useState<boolean>(false);
  const [isIBMembershipModalOpen, setIsIBMembershipModalOpen] = useState<boolean>(false);
  const [isAboutUsOpen, setIsAboutUsOpen] = useState<boolean>(false);
  const [isServicesOpen, setIsServicesOpen] = useState<boolean>(false);
  const [isContactOpen, setIsContactOpen] = useState<boolean>(false);
  const [isIBPartnerFormOpen, setIsIBPartnerFormOpen] = useState<boolean>(false);
  const [isLegalOpen, setIsLegalOpen] = useState<boolean>(false);
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms'>('privacy');
  const [isLiveEarningsOpen, setIsLiveEarningsOpen] = useState<boolean>(false);
  const [showWelcomeIntro, setShowWelcomeIntro] = useState<boolean>(true);

  const handleLogout = async () => {
    try {
      localStorage.removeItem('dollarcraft_active_user');
      setUser(null);
      setDeposits([]);
      setTransactions([]);
      setReferrals([]);
      setIsAuthOpen(true);
      setActiveTab('pro_dashboard');

      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        const { logoutFirebase } = await import('./lib/firebase');
        await logoutFirebase();
      } catch (e) {
        console.warn('Logout API notice:', e);
      }

      await fetchState(true);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const hasCheckedAuthRef = React.useRef(false);

  // Fetch initial dashboard state
  const fetchState = async (userOrLogout?: boolean | User | null) => {
    try {
      const isLogout = userOrLogout === true || userOrLogout === null;
      const explicitUser = typeof userOrLogout === 'object' && userOrLogout !== null ? userOrLogout : null;

      if (isLogout) {
        setUser(null);
        localStorage.removeItem('dollarcraft_active_user');
        setDeposits([]);
        setTransactions([]);
        setReferrals([]);
      }

      const local = localStorage.getItem('dollarcraft_active_user');
      let savedUserEmail = explicitUser?.email || user?.email || '';
      let savedUserId = explicitUser?.id || user?.id || '';

      if (!isLogout && !savedUserEmail && local) {
        try {
          const parsed = JSON.parse(local);
          if (parsed?.email) savedUserEmail = parsed.email;
          if (parsed?.id) savedUserId = parsed.id;
        } catch (e) {}
      }

      if (savedUserEmail) {
        savedUserEmail = savedUserEmail.trim().toLowerCase();
      }

      const headers: Record<string, string> = {};
      if (savedUserEmail) headers['x-user-email'] = savedUserEmail;
      if (savedUserId) headers['x-user-id'] = savedUserId;

      const q = new URLSearchParams();
      if (savedUserEmail) q.set('userEmail', savedUserEmail);
      if (savedUserId) q.set('userId', savedUserId);

      const res = await fetch(`/api/dashboard/state?${q.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (!isLogout && data.user) {
          const nowSec = Math.floor(Date.now() / 1000);
          let parsedCreatedSec = 0;
          if (data.user.createdAt) {
            const t = new Date(data.user.createdAt).getTime();
            if (!isNaN(t) && t > 0) parsedCreatedSec = Math.floor(t / 1000);
          }
          data.user.depositStartTime = data.user.depositStartTime && data.user.depositStartTime > 0 ? data.user.depositStartTime : (parsedCreatedSec || nowSec);
          data.user.baseEarnedYield = data.user.baseEarnedYield !== undefined && data.user.baseEarnedYield !== null
            ? String(data.user.baseEarnedYield)
            : '0.000000000000000000';

          setUser((prevUser) => {
            if (!prevUser) {
              localStorage.setItem('dollarcraft_active_user', JSON.stringify(data.user));
              return data.user;
            }

            const prevEmail = (prevUser.email || '').toLowerCase().trim();
            const dataEmail = (data.user.email || '').toLowerCase().trim();

            // Strict User Isolation: If user emails do not match, discard prevUser completely!
            if (prevEmail && dataEmail && prevEmail !== dataEmail) {
              localStorage.setItem('dollarcraft_active_user', JSON.stringify(data.user));
              return data.user;
            }

            const incomingBalBN = new BigNumber(data.user.principalBalance || '0');
            const incomingYieldBN = new BigNumber(data.user.earnedYield !== undefined ? data.user.earnedYield : '0');
            const prevYieldBN = new BigNumber(prevUser.earnedYield || '0');
            const finalYieldBN = BigNumber.max(prevYieldBN, incomingYieldBN);

            const totalDepNum = Math.max(0, Number(data.user.totalDeposit || incomingBalBN.toNumber()));
            const totalBalNum = data.user.totalBalance !== undefined && Number(data.user.totalBalance) > 0
              ? Number(data.user.totalBalance)
              : Math.max(0, totalDepNum + finalYieldBN.toNumber());

            const effDepositStart = resolveCanonicalDepositStartTime(
              { ...prevUser, ...data.user },
              data.user.activeInvestment || prevUser.activeInvestment,
              data.deposits || deposits
            );

            const effBaseYield = data.user.baseEarnedYield || prevUser.baseEarnedYield || '0.000000000000000000';

            const mergedUser: User = {
              ...prevUser,
              ...data.user,
              principalBalance: incomingBalBN.toFixed(18),
              earnedYield: finalYieldBN.toFixed(18),
              totalDeposit: totalDepNum,
              totalBalance: totalBalNum,
              depositStartTime: effDepositStart,
              baseEarnedYield: effBaseYield
            };

            localStorage.setItem('dollarcraft_active_user', JSON.stringify(mergedUser));
            return mergedUser;
          });
        } else if (isLogout) {
          setUser(null);
          localStorage.removeItem('dollarcraft_active_user');
        }

        if (!hasCheckedAuthRef.current) {
          hasCheckedAuthRef.current = true;
          if (!data.user && !savedUserEmail && !user) {
            setIsAuthOpen(true);
          } else if (data.user || user || savedUserEmail) {
            setIsAuthOpen(false);
            setActiveTab('customer_dashboard');
          }
        }
        setDeposits(isLogout ? [] : (data.deposits || []));
        setTransactions(isLogout ? [] : (data.transactions || []));
        setReferrals(isLogout ? [] : (data.referrals || []));
        setPlans((data.plans && data.plans.length > 0) ? data.plans : INITIAL_PLANS);
        setMetrics(data.metrics || null);
      }

      const usersRes = await fetch('/api/admin/users');
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        if (Array.isArray(usersData.users) && usersData.users.length > 0) {
          setAllUsers((prev) => {
            const map = new Map<string, User>();
            [...prev, ...usersData.users].forEach((u) => {
              if (u && (u.email || u.id)) {
                const key = (u.email || u.id).toLowerCase().trim();
                map.set(key, { ...(map.get(key) || {}), ...u });
              }
            });
            return Array.from(map.values());
          });
        }
      }
    } catch (err) {
      console.warn('Dashboard state sync notice:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(() => {
      fetchState();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Connect to SSE Yield Stream for Sub-Second Live Ticking
  useEffect(() => {
    const local = localStorage.getItem('dollarcraft_active_user');
    let savedEmail = user?.email || '';
    let savedId = user?.id || '';
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (parsed?.email) savedEmail = parsed.email;
        if (parsed?.id) savedId = parsed.id;
      } catch (e) {}
    }

    const q = new URLSearchParams();
    if (savedEmail) q.set('userEmail', savedEmail.trim().toLowerCase());
    if (savedId) q.set('userId', savedId);

    const eventSource = new EventSource(`/api/yield/stream?${q.toString()}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data) return;

        setUser((prev) => {
          if (!prev) return prev;
          const currentEmail = (prev.email || '').trim().toLowerCase();
          const targetEmail = (data.userEmail || '').trim().toLowerCase();

          if (
            targetEmail &&
            currentEmail &&
            targetEmail !== currentEmail &&
            data.userId !== prev.id
          ) {
            return prev;
          }

          const prevBalBN = new BigNumber(prev.principalBalance || '0');
          const incomingBalBN = new BigNumber(data.principalBalance !== undefined ? data.principalBalance : '0');
          const finalBalBN = BigNumber.max(prevBalBN, incomingBalBN);

          const prevYieldBN = new BigNumber(prev.earnedYield || '0');
          const incomingYieldBN = new BigNumber(data.earnedYield !== undefined ? data.earnedYield : '0');
          const prevWithdrawn = new BigNumber(prev.totalWithdrawn || '0');
          const incomingWithdrawn = new BigNumber(data.totalWithdrawn !== undefined ? data.totalWithdrawn : prevWithdrawn);

          let finalYieldBN = incomingYieldBN;
          if (incomingWithdrawn.gte(prevWithdrawn)) {
            finalYieldBN = incomingYieldBN;
          } else {
            finalYieldBN = prevYieldBN;
          }

          const finalBalNum = finalBalBN.toNumber();
          const finalYieldNum = finalYieldBN.toNumber();
          const finalTotalDep = Math.max(finalBalNum, Number(prev.totalDeposit || 0));
          const finalTotalBal = Math.max(finalTotalDep + finalYieldNum, Number(prev.totalBalance || 0));

          const nowSec = Math.floor(Date.now() / 1000);
          return {
            ...prev,
            principalBalance: finalBalBN.toFixed(18),
            earnedYield: finalYieldBN.toFixed(18),
            totalDeposit: finalTotalDep,
            totalBalance: finalTotalBal,
            depositStartTime: nowSec,
            baseEarnedYield: finalYieldBN.toFixed(18)
          };
        });

        if (data.microYieldPerSecond) {
          setMicroYieldPerSecond(data.microYieldPerSecond);
        }

        // Update active cycles earned yield
        if (data.activeCycles && Array.isArray(data.activeCycles)) {
          setDeposits((prevDeposits) =>
            prevDeposits.map((dep) => {
              if (!dep) return dep;
              const match = data.activeCycles.find((c: any) => c && c.id === dep.id);
              if (match) {
                return {
                  ...dep,
                  earnedYield: match.earnedYield,
                  progressPercent: match.progressPercent
                };
              }
              return dep;
            })
          );
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    eventSource.onerror = () => {
      setIsLiveStreaming(false);
    };

    return () => {
      eventSource.close();
    };
  }, [user?.email, user?.id]);

  // Handlers
  const handleCreateDeposit = async (planId: string, amount: number, network: string, txHash: string) => {
    try {
      // Check for duplicate Transaction ID in Firestore first
      try {
        const { db, auth, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError } = await import('./lib/firebase');
        if (!isClientFirestoreQuotaExceeded && auth.currentUser && txHash.trim()) {
          const { collection, query, where, getDocs } = await import('firebase/firestore');
          const depositsRef = collection(db, 'deposits');
          const q = query(
            depositsRef,
            where('transactionId', '==', txHash.trim()),
            where('status', 'in', ['pending', 'approved', 'PENDING', 'APPROVED', 'ACTIVE'])
          );
          const snap = await getDocs(q).catch((e) => {
            handleClientFirestoreQuotaError(e);
            return null;
          });
          if (snap && !snap.empty) {
            return {
              success: false,
              error: 'This Transaction ID is already in use. Please enter the correct one from your bank receipt.'
            };
          }
        }
      } catch (checkErr) {
        console.warn('Firestore duplicate pre-check notice:', checkErr);
      }

      const res = await fetch('/api/deposit/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, amount, network, txHash })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        return { success: false, error: data.error || 'Deposit request failed.' };
      }

      // Sync deposit document to Firestore if Firebase user exists
      try {
        const { db, auth, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError } = await import('./lib/firebase');
        if (!isClientFirestoreQuotaExceeded && auth.currentUser) {
          const { collection, addDoc } = await import('firebase/firestore');
          await addDoc(collection(db, 'deposits'), {
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email || user?.email || '',
            amount,
            transactionId: txHash.trim(),
            bankName: 'Mashreq Bank',
            planId,
            status: 'pending',
            createdAt: new Date().toISOString()
          }).catch((e) => handleClientFirestoreQuotaError(e));
        }
      } catch (fsErr) {
        console.warn('Firestore deposit sync notice:', fsErr);
      }

      await fetchState();
      return { success: true, message: data.message };
    } catch (err: any) {
      console.warn('Deposit request notice:', err);
      return { 
        success: false, 
        error: err.message === 'Failed to fetch' 
          ? 'Network connection issue. Please check your internet connection and try again.' 
          : (err.message || 'Server error occurred.') 
      };
    }
  };

  const handleSubmitWithdrawal = async (amount: number, destinationAddr: string, network: string) => {
    if (!user) {
      return { success: false, message: 'User session not found. Please log in.' };
    }

    // Enforce strict minimum $50 check
    if (amount < 50) {
      return { success: false, message: 'Minimum withdrawal amount is $50.' };
    }

    const userYieldBN = new BigNumber(user.earnedYield || '0');
    const userDailyProfitBN = new BigNumber(user.dailyProfit || 0);
    const userTotalBalBN = new BigNumber(user.totalBalance || 0);
    const maxAvailable = BigNumber.max(userYieldBN, userDailyProfitBN, userTotalBalBN);

    if (new BigNumber(amount).isGreaterThan(maxAvailable) && maxAvailable.isGreaterThan(0)) {
      return { success: false, message: 'Insufficient balance.' };
    }

    // Deduct requested amount directly from user's dailyProfit (earnedYield) and totalBalance
    const newYieldBN = BigNumber.max(0, userYieldBN.minus(amount));
    const newYieldStr = newYieldBN.toFixed(18);
    const newDailyProfit = newYieldBN.toNumber();
    const newWithdrawnStr = new BigNumber(user.totalWithdrawn || '0').plus(amount).toFixed(18);
    const totalDepNum = parseFloat(String(user.totalDeposit || user.principalBalance || '0')) || 0;
    const newTotBal = Math.max(0, totalDepNum + newYieldBN.toNumber());

    const nowSec = Math.floor(Date.now() / 1000);
    const updatedUser: User = {
      ...user,
      earnedYield: newYieldStr,
      dailyProfit: newDailyProfit,
      totalWithdrawn: newWithdrawnStr,
      totalBalance: newTotBal,
      baseEarnedYield: newYieldStr,
      depositStartTime: nowSec
    };

    // 1. Update React user state immediately (INSTANT UI RE-RENDER)
    setUser(updatedUser);

    // 2. Record request in Admin Panel & Customer history under 'Withdrawals & History' with status 'PENDING'
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      userId: user.id,
      userEmail: user.email,
      type: 'WITHDRAWAL',
      amount: amount.toFixed(2),
      precisionAmount: amount.toFixed(18),
      destinationAddr: destinationAddr || '',
      cryptoNetwork: network || 'BANK_TRANSFER',
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };

    setTransactions((prev) => [newTx, ...prev.filter(t => t.id !== newTx.id)]);

    // 3. Save updated user state and transaction to LocalStorage immediately
    try {
      localStorage.setItem('dollarcraft_active_user', JSON.stringify(updatedUser));
      if (user.id) {
        localStorage.setItem(`dollarcraft_accumulated_profit_${user.id}`, newYieldStr);
      }
      if (user.email) {
        localStorage.setItem(`dollarcraft_accumulated_profit_${user.email.toLowerCase().trim()}`, newYieldStr);
      }

      const userKeys = ['dollar_craft_users', 'dollar_craft_registered_users', 'dc_registered_users', 'registered_users'];
      userKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const updated = parsed.map((u: any) => {
                if (u && u.email && u.email.toLowerCase() === user.email.toLowerCase()) {
                  return {
                    ...u,
                    earnedYield: newYieldStr,
                    dailyProfit: newDailyProfit,
                    totalWithdrawn: newWithdrawnStr,
                    totalBalance: newTotBal
                  };
                }
                return u;
              });
              localStorage.setItem(key, JSON.stringify(updated));
            }
          } catch (e) {}
        }
      });

      const txKeys = ['dollar_craft_transactions', 'dc_transactions', 'dollar_craft_withdrawals', 'dollarcraft_withdrawals', 'dollarcraft_transactions'];
      txKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        let list: any[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed;
          } catch (e) {}
        }
        if (!list.some(t => t.id === newTx.id)) {
          list.unshift(newTx);
          localStorage.setItem(key, JSON.stringify(list));
        }
      });

      window.dispatchEvent(new Event('dollar_craft_users_updated'));
      window.dispatchEvent(new Event('dollar_craft_transactions_updated'));
    } catch (lsErr) {
      console.warn('LocalStorage withdrawal update error:', lsErr);
    }

    // 4. Send fast server API request
    let serverMessage = 'Your withdraw approved in 24-48 hours';
    try {
      const res = await fetch('/api/withdrawal/request', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': user.id || '',
          'x-user-email': user.email || ''
        },
        body: JSON.stringify({ 
          clientTxId: newTx.id,
          amount, 
          destinationAddr, 
          network,
          userId: user.id,
          userEmail: user.email
        })
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data && data.message) {
        serverMessage = data.message;
      }
    } catch (err: any) {
      console.warn('Network error during withdrawal request:', err);
    }

    // 5. Save updated user balance state and withdrawal transaction to Firestore in background (NON-BLOCKING)
    (async () => {
      try {
        const { db, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError } = await import('./lib/firebase');
        if (isClientFirestoreQuotaExceeded) return;
        const { doc, setDoc } = await import('firebase/firestore');
        const emailClean = user.email.toLowerCase().trim();
        const userPayload = {
          earnedYield: Number(newYieldStr),
          dailyProfit: newDailyProfit,
          totalWithdrawn: Number(newWithdrawnStr),
          totalBalance: newTotBal,
          baseEarnedYield: updatedUser.baseEarnedYield,
          depositStartTime: updatedUser.depositStartTime,
          updatedAt: new Date().toISOString()
        };
        if (emailClean) {
          setDoc(doc(db, 'users', emailClean), userPayload, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
        }
        if (user.id && user.id !== emailClean) {
          setDoc(doc(db, 'users', user.id), userPayload, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
        }
        setDoc(doc(db, 'withdrawals', newTx.id), newTx, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
      } catch (fsErr) {
        console.warn('Firestore background withdrawal sync error:', fsErr);
      }
    })();

    return { success: true, message: serverMessage };
  };

  const handleApproveWithdrawal = async (txId: string) => {
    // 1. Immediately update React state for instant UI reflection
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, status: 'APPROVED', approvedAt: new Date().toISOString() } : t))
    );

    // 2. Immediately sync LocalStorage
    try {
      const txKeys = ['dollar_craft_transactions', 'dc_transactions', 'dollar_craft_withdrawals', 'dc_withdrawals'];
      txKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const updated = parsed.map((t: any) => {
                if (t && (t.id === txId || t.txHash === txId)) {
                  return { ...t, status: 'APPROVED', approvedAt: new Date().toISOString() };
                }
                return t;
              });
              localStorage.setItem(key, JSON.stringify(updated));
            }
          } catch (e) {}
        }
      });
      window.dispatchEvent(new Event('dollar_craft_transactions_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (lsErr) {
      console.warn('LocalStorage approve withdrawal error:', lsErr);
    }

    // 3. Send server API request & update Firestore
    try {
      await fetch('/api/admin/withdrawal/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId })
      });
      const { db, handleClientFirestoreQuotaError } = await import('./lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'withdrawals', txId), { 
        status: 'APPROVED', 
        approvedAt: new Date().toISOString() 
      }, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
    } catch (e) {
      console.warn('Approve withdrawal sync error:', e);
    }
    fetchState();
  };

  const handleRejectWithdrawal = async (txId: string, reason: string) => {
    // 1. Immediately update React state for instant UI reflection
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, status: 'REJECTED', rejectionReason: reason, rejectedAt: new Date().toISOString() } : t))
    );

    // 2. Immediately sync LocalStorage
    try {
      const txKeys = ['dollar_craft_transactions', 'dc_transactions', 'dollar_craft_withdrawals', 'dc_withdrawals'];
      txKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const updated = parsed.map((t: any) => {
                if (t && (t.id === txId || t.txHash === txId)) {
                  return { ...t, status: 'REJECTED', rejectionReason: reason, rejectedAt: new Date().toISOString() };
                }
                return t;
              });
              localStorage.setItem(key, JSON.stringify(updated));
            }
          } catch (e) {}
        }
      });
      window.dispatchEvent(new Event('dollar_craft_transactions_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (lsErr) {
      console.warn('LocalStorage reject withdrawal error:', lsErr);
    }

    // 3. Send server API request & update Firestore
    try {
      await fetch('/api/admin/withdrawal/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId, reason })
      });
      const { db, handleClientFirestoreQuotaError } = await import('./lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'withdrawals', txId), { 
        status: 'REJECTED', 
        rejectionReason: reason,
        rejectedAt: new Date().toISOString() 
      }, { merge: true }).catch((e) => handleClientFirestoreQuotaError(e));
    } catch (e) {
      console.warn('Reject withdrawal sync error:', e);
    }
    fetchState();
  };

  const handleFreezeUser = async (userId: string, reason: string) => {
    await fetch('/api/admin/user/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason })
    });
    fetchState();
  };

  const handleUnfreezeUser = async (userId: string) => {
    await fetch('/api/admin/user/unfreeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    fetchState();
  };

  if (showWelcomeIntro) {
    return <WelcomeIntro onComplete={() => setShowWelcomeIntro(false)} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020611] flex flex-col items-center justify-center text-white font-mono">
        <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-3 animate-pulse">
          <Zap className="w-5 h-5 text-cyan-400" />
        </div>
        <p className="text-xs font-bold text-slate-300 tracking-wider uppercase">Loading Ecosystem...</p>
      </div>
    );
  }

  const activeDeposits = deposits.filter((d) => d.status === 'ACTIVE');

  return (
    <div className={`min-h-screen w-full max-w-full overflow-x-hidden font-sans transition-colors duration-300 selection:bg-cyan-500 selection:text-black ${
      theme === 'light' ? 'light bg-slate-50 text-slate-900' : 'dark bg-[#07090E] text-slate-100'
    }`}>

      {/* Top Header Navigation */}
      <Header
        user={user}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenWithdrawal={() => setIsWithdrawalOpen(true)}
        onOpenAdmin={() => {
          if (user?.email?.toLowerCase() === 'dollarcraft3@gmail.com' || user?.role === 'ADMIN') {
            setActiveTab('admin');
            setIsAdminOpen(true);
          } else {
            setIsAccessDeniedOpen(true);
            setActiveTab('customer_dashboard');
          }
        }}
        onOpenMasterPlan={() => setIsMasterPlanOpen(true)}
        onOpenAuth={handleOpenAuth}
        onOpenGmailModal={() => setIsGmailModalOpen(true)}
        onOpenInternalTransfer={() => setActiveTab('internal_transfer')}
        onOpenAboutUs={() => setIsAboutUsOpen(true)}
        onOpenServices={() => setIsServicesOpen(true)}
        onOpenContact={() => setIsContactOpen(true)}
        onOpenIBPartner={() => setIsIBPartnerFormOpen(true)}
        onOpenLiveEarnings={() => setIsLiveEarningsOpen(true)}
        onReplayIntro={() => setShowWelcomeIntro(true)}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Account Frozen Alert Banner */}
      {user?.isFrozen && (
        <div className="bg-red-500/10 border-b border-red-500/30 p-3 text-red-400 font-mono text-xs flex items-center justify-center gap-2">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <span>ACCOUNT FROZEN BY SECURITY DESK: {user.frozenReason || 'Math verification audit pending.'}</span>
        </div>
      )}

      {/* Main Dashboard Layout */}
      <main className="w-full max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-8 overflow-x-hidden">
        
        {(activeTab === 'pro_dashboard' || activeTab === 'dashboard') && (
          <DollarCraftDashboard
            user={user}
            activeTab={activeTab}
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenWithdraw={() => setIsWithdrawalOpen(true)}
            onOpenIB={() => setActiveTab('ib_dashboard')}
            onOpenAboutUs={() => setIsAboutUsOpen(true)}
            onOpenServices={() => setIsServicesOpen(true)}
            onOpenContact={() => setIsContactOpen(true)}
            onOpenIBPartner={() => setIsIBPartnerFormOpen(true)}
            onOpenMasterPlan={() => setIsMasterPlanOpen(true)}
            onOpenAuth={handleOpenAuth}
          />
        )}

        {(activeTab === 'customer_dashboard' || activeTab === 'admin') && (
          <CustomerDashboardView
            currentUser={user}
            deposits={deposits}
            transactions={transactions}
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenWithdraw={() => setIsWithdrawalOpen(true)}
            onOpenMasterPlan={() => setIsMasterPlanOpen(true)}
            onOpenAuth={handleOpenAuth}
            onRefreshData={fetchState}
          />
        )}

        {activeTab === 'ib_dashboard' && (
          <IBDashboardView
            currentUser={user}
            onOpenApplyModal={() => setIsIBMembershipModalOpen(true)}
            onOpenIBPartner={() => setIsIBPartnerFormOpen(true)}
            onRefreshUser={fetchState}
          />
        )}

        {(activeTab === 'about_us' || activeTab === 'about') && (
          <AboutUsView
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenIBPartner={() => setIsIBPartnerFormOpen(true)}
          />
        )}

        {activeTab === 'cycles' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white">Investment Yield Cycles</h2>
                <p className="text-xs text-zinc-400">Lock principal into defined interest contracts with sub-second yield streaming.</p>
              </div>
              <button
                onClick={() => setIsDepositOpen(true)}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs"
              >
                Craft New Cycle
              </button>
            </div>

            <ActiveCyclesTable
              deposits={deposits}
              onOpenDepositModal={() => setIsDepositOpen(true)}
            />
          </div>
        )}

        {activeTab === 'referrals' && (
          <ReferralSystem user={user} rewards={referrals} />
        )}

        {activeTab === 'history' && (
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 text-white">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" />
              <span>Transaction & Yield Audit Ledger</span>
            </h3>

            {transactions.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-xs font-mono bg-zinc-950 rounded-xl border border-zinc-800">
                No recorded transactions in ledger.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800 pb-2">
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Amount</th>
                      <th className="py-3 px-3">Network / Details</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {transactions.filter(tx => tx && tx.id).map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            tx.type === 'DEPOSIT' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                          }`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-white">${tx.amount}</td>
                        <td className="py-3 px-3 text-zinc-400">
                          {tx.cryptoNetwork || 'System Ledger'} {tx.txHash && `(${tx.txHash.substring(0, 8)}...)`}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            tx.status === 'APPROVED' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-zinc-500">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'internal_transfer' && (
          <InternalTransferPanel
            users={allUsers.length > 0 ? allUsers : (user ? [user] : [])}
            onRefreshData={fetchState}
          />
        )}

      </main>

      {/* FOOTER SECTION WITH COUNTRY FLAGS & QUICK LINKS */}
      <footer className="mt-16 bg-[#05070B] border-t border-slate-800/90 text-slate-400 font-sans py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-10">
          


          {/* Bottom Copyright & Disclaimer */}
          <div className="pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500">
            <p>© 2018 Dollar Craft. All Rights Reserved.</p>
            <div className="flex items-center gap-4 text-[11px]">
              <button 
                onClick={() => { setLegalTab('privacy'); setIsLegalOpen(true); }} 
                className="hover:text-cyan-400 transition-colors cursor-pointer"
              >
                Privacy Policy
              </button>
              <span>•</span>
              <button 
                onClick={() => { setLegalTab('terms'); setIsLegalOpen(true); }} 
                className="hover:text-cyan-400 transition-colors cursor-pointer"
              >
                Terms of Service
              </button>
            </div>
          </div>

        </div>
      </footer>

      {/* Modals */}
      <DepositModal
        plans={plans}
        isOpen={isDepositOpen}
        initialPlanId={selectedPlanForDeposit}
        currentUser={user}
        onClose={() => {
          setIsDepositOpen(false);
          setIsMasterPlanOpen(true);
        }}
        onSubmitDeposit={async (planId, amount, network, txHash) => {
          return await handleCreateDeposit(planId, amount, network, txHash);
        }}
      />

      <WithdrawalModal
        isOpen={isWithdrawalOpen}
        onClose={() => setIsWithdrawalOpen(false)}
        availableBalance={user ? user.earnedYield || '0' : '0'}
        earnedYield={user?.earnedYield || '0'}
        onSubmitWithdrawal={handleSubmitWithdrawal}
      />

      {(user?.email?.toLowerCase() === 'dollarcraft3@gmail.com' || user?.role === 'ADMIN') && (
        <AdminPanel
          isOpen={isAdminOpen}
          onClose={() => setIsAdminOpen(false)}
          metrics={metrics || {
            totalSystemDeposits: '0.00',
            totalSystemYieldPaid: '0.00',
            totalSystemWithdrawals: '0.00',
            activeUsersCount: allUsers.length || 1,
            pendingDepositsCount: deposits.filter(d => d.status === 'PENDING').length,
            pendingWithdrawalsCount: transactions.filter(t => t.type === 'WITHDRAWAL' && t.status === 'PENDING').length,
            networkVolume: '0.00'
          }}
          users={allUsers.length > 0 ? allUsers : (user ? [user] : [])}
          transactions={transactions}
          plans={plans}
          onApproveWithdrawal={handleApproveWithdrawal}
          onRejectWithdrawal={handleRejectWithdrawal}
          onFreezeUser={handleFreezeUser}
          onUnfreezeUser={handleUnfreezeUser}
          onUpdatePlanRate={(planId, newRate) => {
            setPlans(plans.map(p => p.id === planId ? { ...p, dailyYieldPercent: newRate } : p));
          }}
          currentUser={user}
          onRefreshData={fetchState}
        />
      )}

      <AccessDeniedModal
        isOpen={isAccessDeniedOpen}
        onClose={() => {
          setIsAccessDeniedOpen(false);
          setActiveTab('customer_dashboard');
        }}
        userEmail={user?.email}
      />

      <MasterPlanModal
        isOpen={isMasterPlanOpen}
        onClose={() => setIsMasterPlanOpen(false)}
        plans={plans}
        currentUser={user}
        onActivatePlan={(plan) => {
          if (plan?.id) {
            setSelectedPlanForDeposit(plan.id);
          }
          setIsMasterPlanOpen(false);
          setIsDepositOpen(true);
        }}
        onSelectPlan={(plan) => {
          if (plan?.id) {
            setSelectedPlanForDeposit(plan.id);
          }
          setIsMasterPlanOpen(false);
          setIsDepositOpen(true);
        }}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentUser={user}
        initialMode={authInitialMode}
        onLoginSuccess={(u) => {
          setUser(u);
          try {
            localStorage.setItem('dollarcraft_active_user', JSON.stringify(u));
          } catch (e) {}
          fetchState(u);
          setActiveTab('customer_dashboard');
          setIsLiveEarningsOpen(false);
        }}
        onLogout={handleLogout}
      />

      <LiveEarningsModal
        isOpen={isLiveEarningsOpen}
        onClose={() => setIsLiveEarningsOpen(false)}
        user={user}
        onOpenMasterPlan={() => {
          setIsLiveEarningsOpen(false);
          setIsMasterPlanOpen(true);
        }}
      />

      <GmailIntegrationModal
        isOpen={isGmailModalOpen}
        onClose={() => setIsGmailModalOpen(false)}
        currentUser={user}
      />

      <IBApplicationModal
        isOpen={isIBApplyOpen}
        onClose={() => setIsIBApplyOpen(false)}
        currentUser={user}
        onSuccess={() => {
          fetchState();
        }}
      />

      <IBMembershipModal
        isOpen={isIBMembershipModalOpen}
        onClose={() => setIsIBMembershipModalOpen(false)}
        currentUser={user}
        onSuccess={() => {
          fetchState();
        }}
      />

      <AboutUsModal
        isOpen={isAboutUsOpen}
        onClose={() => setIsAboutUsOpen(false)}
        onOpenIBPartner={() => setIsIBPartnerFormOpen(true)}
      />

      <ServicesModal
        isOpen={isServicesOpen}
        onClose={() => setIsServicesOpen(false)}
        onOpenDeposit={() => setIsDepositOpen(true)}
      />

      <ContactModal
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />

      <IBPartnerFormModal
        isOpen={isIBPartnerFormOpen}
        onClose={() => setIsIBPartnerFormOpen(false)}
        currentUser={user}
      />

      <LegalModal
        isOpen={isLegalOpen}
        onClose={() => setIsLegalOpen(false)}
        defaultTab={legalTab}
      />

    </div>
  );
}
