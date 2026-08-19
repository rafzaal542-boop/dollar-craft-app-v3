import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { User, UserDeposit, Transaction } from '../types';
import { getPlanRates, calculateServerTimestampYield, resolveCanonicalDepositStartTime, computeLiveUserAccruedProfit } from '../lib/yieldEngine';
import { 
  User as UserIcon, 
  UserCheck, 
  Mail, 
  ShieldCheck, 
  BadgeCheck, 
  Copy, 
  Check, 
  Key, 
  Wallet, 
  DollarSign, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Award, 
  Lock, 
  CheckCircle2, 
  LogIn, 
  Clock, 
  Send, 
  Sparkles, 
  Calendar, 
  RefreshCw,
  ExternalLink,
  Shield,
  Layers,
  Gift
} from 'lucide-react';

interface CustomerDashboardViewProps {
  currentUser?: User | null;
  deposits?: UserDeposit[];
  transactions?: Transaction[];
  onOpenDeposit?: () => void;
  onOpenWithdraw?: (liveProfit?: number) => void;
  onOpenMasterPlan?: () => void;
  onOpenAuth?: (mode?: 'login' | 'signup') => void;
  onOpenInternalTransfer?: () => void;
  onRefreshData?: () => void;
  onSyncLiveProfit?: (liveProfit: number) => void;
}

export const CustomerDashboardView: React.FC<CustomerDashboardViewProps> = ({
  currentUser,
  deposits = [],
  transactions = [],
  onOpenDeposit,
  onOpenWithdraw,
  onOpenMasterPlan,
  onOpenAuth,
  onOpenInternalTransfer,
  onRefreshData,
  onSyncLiveProfit
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'deposits' | 'transfers'>('profile');
  const [internalTransfers, setInternalTransfers] = useState<any[]>([]);
  const [userWithdrawals, setUserWithdrawals] = useState<any[]>([]);

  const fetchUserData = async () => {
    const userEmail = (currentUser?.email || '').trim().toLowerCase();
    const userId = currentUser?.id || '';
    if (!userEmail && !userId) return;

    try {
      const q = new URLSearchParams();
      if (userEmail) q.set('email', userEmail);
      if (userId) q.set('userId', userId);

      const [transRes, wdRes] = await Promise.all([
        fetch(`/api/user/internal-transfers?${q.toString()}`, {
          headers: { 'x-user-email': userEmail, 'x-user-id': userId }
        }).catch(() => null),
        fetch(`/api/user/withdrawals?${q.toString()}`, {
          headers: { 'x-user-email': userEmail, 'x-user-id': userId }
        }).catch(() => null)
      ]);

      if (transRes && transRes.ok) {
        const data = await transRes.json();
        setInternalTransfers(data.transfers || []);
        if (
          data.principalBalance &&
          parseFloat(data.principalBalance) > parseFloat(currentUser?.principalBalance || '0')
        ) {
          if (onRefreshData) onRefreshData();
        }
      }

      if (wdRes && wdRes.ok) {
        const wdData = await wdRes.json();
        setUserWithdrawals(wdData.withdrawals || []);
      } else {
        // Fallback to localStorage withdrawals
        try {
          const rawWd = localStorage.getItem('dollar_craft_withdrawals') || localStorage.getItem('dc_withdrawals');
          if (rawWd) {
            const parsed = JSON.parse(rawWd);
            if (Array.isArray(parsed)) {
              setUserWithdrawals(parsed.filter(w => 
                (w.userEmail && w.userEmail.toLowerCase().trim() === userEmail) ||
                (w.userId && w.userId === userId)
              ));
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Failed to fetch user transfers or withdrawals:', err);
    }
  };

  useEffect(() => {
    fetchUserData();
    const interval = setInterval(fetchUserData, 5000);

    let unsubscribeFirestoreWd: (() => void) | null = null;

    import('../lib/firebase').then(({ db, isClientFirestoreQuotaExceeded, handleClientFirestoreQuotaError }) => {
      if (isClientFirestoreQuotaExceeded) return;
      import('firebase/firestore').then(({ collection, onSnapshot }) => {
        const userEmail = (currentUser?.email || '').trim().toLowerCase();
        const userId = currentUser?.id || '';
        if (!userEmail && !userId) return;

        unsubscribeFirestoreWd = onSnapshot(collection(db, 'withdrawals'), (snapshot) => {
          const fetchedWd = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
          const userWds = fetchedWd.filter(w => {
            const matchEmail = Boolean(userEmail && w.userEmail && w.userEmail.toLowerCase().trim() === userEmail);
            const matchId = Boolean(userId && w.userId && w.userId === userId);
            return matchEmail || matchId;
          });
          if (userWds.length > 0) {
            setUserWithdrawals(prev => {
              const map = new Map<string, any>();
              prev.forEach(item => {
                if (item && item.id) map.set(item.id, item);
              });
              userWds.forEach(item => {
                if (item && item.id) {
                  const existing = map.get(item.id) || {};
                  map.set(item.id, { ...existing, ...item });
                }
              });
              return Array.from(map.values());
            });
          }
        }, (err) => handleClientFirestoreQuotaError(err));
      });
    });

    const handleUpdate = () => {
      fetchUserData();
    };

    window.addEventListener('dollar_craft_transactions_updated', handleUpdate);
    window.addEventListener('dollar_craft_users_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('focus', handleUpdate);

    return () => {
      clearInterval(interval);
      if (unsubscribeFirestoreWd) unsubscribeFirestoreWd();
      window.removeEventListener('dollar_craft_transactions_updated', handleUpdate);
      window.removeEventListener('dollar_craft_users_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('focus', handleUpdate);
    };
  }, [currentUser?.email, currentUser?.id]);

  // Merge API userWithdrawals, transactions prop, and LocalStorage records cleanly
  const displayWithdrawals = useMemo(() => {
    const userEmail = (currentUser?.email || '').trim().toLowerCase();
    const userId = currentUser?.id || '';

    const map = new Map<string, any>();

    const mergeIntoMap = (key: string, item: any) => {
      if (!key || !item) return;
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key);
        const statusPriority: Record<string, number> = { APPROVED: 3, REJECTED: 3, PENDING: 1 };
        const exPri = statusPriority[existing.status] || 1;
        const itemPri = statusPriority[item.status] || 1;
        const finalStatus = itemPri >= exPri ? (item.status || existing.status) : existing.status;
        map.set(key, { ...existing, ...item, status: finalStatus });
      }
    };

    // 1. Transactions from App state
    (transactions || []).forEach((t) => {
      if (t.type === 'WITHDRAWAL') {
        const matchEmail = Boolean(userEmail && t.userEmail && t.userEmail.toLowerCase().trim() === userEmail);
        const matchId = Boolean(userId && t.userId && t.userId === userId);
        if (matchEmail || matchId) {
          const key = t.id || t.txHash;
          if (key) mergeIntoMap(key, t);
        }
      }
    });

    // 2. LocalStorage withdrawals
    try {
      const keys = ['dollar_craft_withdrawals', 'dc_withdrawals', 'dollar_craft_transactions', 'dc_transactions'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach((w) => {
              if (w.type === 'WITHDRAWAL' || k.includes('withdrawals')) {
                const matchEmail = Boolean(userEmail && w.userEmail && w.userEmail.toLowerCase().trim() === userEmail);
                const matchId = Boolean(userId && w.userId && w.userId === userId);
                if (matchEmail || matchId) {
                  const key = w.id || w.txHash || `ls-${w.createdAt}-${w.amount}`;
                  mergeIntoMap(key, w);
                }
              }
            });
          }
        }
      }
    } catch (e) {}

    // 3. API & Firestore fetched userWithdrawals
    (userWithdrawals || []).forEach((w) => {
      const matchEmail = Boolean(userEmail && w.userEmail && w.userEmail.toLowerCase().trim() === userEmail);
      const matchId = Boolean(userId && w.userId && w.userId === userId);
      if (matchEmail || matchId) {
        const key = w.id || w.txHash || `api-${w.createdAt}-${w.amount}`;
        mergeIntoMap(key, w);
      }
    });

    const allList = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt || b.startTime || Date.now()).getTime() - new Date(a.createdAt || a.startTime || Date.now()).getTime()
    );

    const deduplicated: any[] = [];
    allList.forEach((w) => {
      const wTime = new Date(w.createdAt || Date.now()).getTime();
      const wAmt = parseFloat(String(w.amount || '0')) || 0;

      const existingIdx = deduplicated.findIndex((existing) => {
        if (existing.id && w.id && existing.id === w.id) return true;
        if (existing.txHash && w.txHash && existing.txHash === w.txHash) return true;
        const exTime = new Date(existing.createdAt || Date.now()).getTime();
        const exAmt = parseFloat(String(existing.amount || '0')) || 0;
        const sameEmail = Boolean(existing.userEmail && w.userEmail && existing.userEmail.toLowerCase().trim() === w.userEmail.toLowerCase().trim());
        const sameAmount = Math.abs(exAmt - wAmt) < 0.01;
        const closeTime = Math.abs(exTime - wTime) < 20000;
        return sameEmail && sameAmount && closeTime;
      });

      if (existingIdx >= 0) {
        const existing = deduplicated[existingIdx];
        const statusPriority: Record<string, number> = { APPROVED: 3, REJECTED: 3, PENDING: 1 };
        const exPri = statusPriority[existing.status] || 1;
        const wPri = statusPriority[w.status] || 1;
        const finalStatus = wPri >= exPri ? (w.status || existing.status) : existing.status;
        deduplicated[existingIdx] = { ...existing, ...w, status: finalStatus };
      } else {
        deduplicated.push(w);
      }
    });

    return deduplicated;
  }, [userWithdrawals, transactions, currentUser?.email, currentUser?.id]);

  const totalRequestedUSD = useMemo(() => {
    return displayWithdrawals.reduce((sum, w) => sum + (parseFloat(w.amount || 0) || 0), 0);
  }, [displayWithdrawals]);

  const totalApprovedUSD = useMemo(() => {
    return displayWithdrawals
      .filter((w) => w.status === 'APPROVED')
      .reduce((sum, w) => sum + (parseFloat(w.amount || 0) || 0), 0);
  }, [displayWithdrawals]);

  const totalPendingUSD = useMemo(() => {
    return displayWithdrawals
      .filter((w) => !w.status || w.status === 'PENDING')
      .reduce((sum, w) => sum + (parseFloat(w.amount || 0) || 0), 0);
  }, [displayWithdrawals]);

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getCalculatedTotalDeposit = () => {
    if (!currentUser) return '0.0000';
    const depositSum = deposits.reduce(
      (sum, d) => sum + (parseFloat(d.principalAmount || (d as any).amount) || 0),
      0
    );
    const transferSum = internalTransfers
      .filter(
        (t: any) =>
          t.toWalletType === 'MAIN_WALLET' ||
          t.toWalletType === 'INVESTMENT_WALLET' ||
          !t.toWalletType
      )
      .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
    const userPrincipal = parseFloat(currentUser.principalBalance || '0') || 0;
    const userTotalDep = typeof currentUser.totalDeposit === 'number' ? currentUser.totalDeposit : parseFloat(String(currentUser.totalDeposit || '0')) || 0;
    return Math.max(userPrincipal, userTotalDep, depositSum, transferSum).toFixed(4);
  };

  const [liveEarnedProfit, setLiveEarnedProfit] = useState<number>(0);

  // Active React ticker state binding & continuous 100ms live loop that NEVER stops
  useEffect(() => {
    if (!currentUser) {
      setLiveEarnedProfit(0);
      return;
    }

    const computeExact = () => {
      return computeLiveUserAccruedProfit(currentUser, deposits, displayWithdrawals);
    };

    // Immediate non-zero seed on mount/login
    const initialVal = computeExact();
    setLiveEarnedProfit(initialVal);
    if (onSyncLiveProfit) onSyncLiveProfit(initialVal);

    // Active continuous 100ms ticker loop
    const timer = setInterval(() => {
      const val = computeExact();
      setLiveEarnedProfit(val);
      if (onSyncLiveProfit) onSyncLiveProfit(val);
    }, 100);

    return () => clearInterval(timer);
  }, [
    currentUser,
    displayWithdrawals,
    deposits,
    onSyncLiveProfit
  ]);

  const getCalculatedDailyProfit = (): string => {
    if (!currentUser) return '0.0000';
    const totalDep = parseFloat(getCalculatedTotalDeposit()) || 0;
    if (totalDep <= 0) return '0.0000';
    const rates = getPlanRates(totalDep);
    const dailyProfit24h = totalDep * (rates.dailyYieldPercent / 100);
    return dailyProfit24h.toFixed(4);
  };

  const allCombinedDeposits = [...deposits];
  internalTransfers.forEach((itx) => {
    if (
      itx.toWalletType === 'MAIN_WALLET' ||
      itx.toWalletType === 'INVESTMENT_WALLET' ||
      !itx.toWalletType
    ) {
      const exists = allCombinedDeposits.some(
        (d) => d && ((d.txHash && itx.transferId && d.txHash === itx.transferId) || (d.id && itx.transferId && d.id.includes(itx.transferId)))
      );
      if (!exists) {
        const transferAmt = parseFloat(String(itx.amount || '0')) || 0;
        const rates = getPlanRates(transferAmt);
        allCombinedDeposits.unshift({
          id: `dep-${itx.transferId}`,
          userId: currentUser?.id || '',
          userEmail: currentUser?.email || '',
          planId: 'plan-standard',
          planName: rates.planName,
          principalAmount: String(itx.amount || '0'),
          earnedYield: '0.000000000000000000',
          totalPayout: '0',
          dailyYieldPercent: rates.dailyYieldPercent,
          cryptoNetwork: 'Internal Transfer (Main Wallet)',
          txHash: itx.transferId,
          status: 'ACTIVE',
          startTime: itx.createdAt || new Date().toISOString(),
          endTime: new Date(Date.now() + 240 * 86400 * 1000).toISOString(),
          lastYieldTick: new Date().toISOString(),
          progressPercent: 0
        });
      }
    }
  });

  return (
    <div className="w-full bg-[#040812] text-slate-100 p-3 sm:p-6 lg:p-8 font-sans min-h-screen space-y-6 sm:space-y-8">
      
      {/* 1. TOP HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#0A1124] via-[#0E1A38] to-[#080E20] p-6 sm:p-8 rounded-3xl border border-cyan-500/30 shadow-2xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-4 relative z-10">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-teal-500/20 to-blue-600/20 border border-cyan-400/40 text-cyan-300 shadow-lg shadow-cyan-950/50">
            <UserCheck className="w-8 h-8 text-cyan-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-wider font-mono">
                Customer Dashboard
              </h1>
              {currentUser ? (
                <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  AUTHENTICATED
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  GUEST SESSION
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-300 font-mono mt-1">
              Personal customer portal, credentials, portfolio balances & contract yields
            </p>
          </div>
        </div>

        {currentUser && (
          <div className="flex items-center gap-3 flex-wrap relative z-10">
            <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-base shadow-md shrink-0">
                {(currentUser.firstName ? currentUser.firstName[0] : (currentUser.email ? currentUser.email[0] : 'C')).toUpperCase()}
              </div>
              <div className="text-left">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Active Account</span>
                <span className="text-xs font-bold text-white font-mono block truncate max-w-[160px]">
                  {currentUser.email}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. AUTHENTICATED VS LOGGED OUT STATE */}
      {!currentUser ? (
        /* LOGGED OUT GATEWAY CARD */
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-[#0A1226] to-[#050A18] border border-cyan-500/30 text-center space-y-6 shadow-2xl relative overflow-hidden"
        >
          <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-cyan-500/20 via-blue-600/20 to-purple-600/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-xl">
            <UserIcon className="w-10 h-10" />
          </div>

          <div className="max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-wider font-mono">
              Access Your Customer Dashboard
            </h2>
            <p className="text-sm text-slate-300 font-mono leading-relaxed">
              Please log in to your Dollar Craft account to view your signed-in profile details, registered email address, high-precision yield accruals, principal balances, and transaction history.
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              onClick={() => onOpenAuth && onOpenAuth('login')}
              className="px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:brightness-110 text-slate-950 font-black text-sm uppercase font-mono tracking-wider flex items-center gap-2.5 shadow-xl shadow-cyan-500/25 transition-all cursor-pointer active:scale-95"
            >
              <LogIn className="w-5 h-5" />
              <span>LOG IN TO CUSTOMER ACCOUNT</span>
            </button>
          </div>
        </motion.div>
      ) : (
        /* LOGGED IN FULL CUSTOMER DASHBOARD PAGE */
        <div className="space-y-8">
          
          {/* TOP CARDS: FINANCIAL OVERVIEW (3 Full-Width Rows / Lines for Maximum Digit Visibility) */}
          <div className="grid grid-cols-1 gap-4">
            
            {/* Row 1: Total Net Portfolio */}
            <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#0B152C] via-[#081226] to-[#060D1E] border border-cyan-500/40 space-y-2.5 shadow-xl hover:border-cyan-400/70 transition-all">
              <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
                <span className="uppercase font-bold flex items-center gap-2 text-cyan-300 tracking-wider">
                  <Wallet className="w-4.5 h-4.5 text-cyan-400" />
                  TOTAL BALANCE
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-black text-white font-mono tracking-tight break-all">
                ${(parseFloat(getCalculatedTotalDeposit()) + liveEarnedProfit).toFixed(4)}
              </div>
            </div>

            {/* Row 2: Active Principal Deposit */}
            <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#0B152C] via-[#081226] to-[#060D1E] border border-emerald-500/40 space-y-2.5 shadow-xl hover:border-emerald-400/70 transition-all">
              <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
                <span className="uppercase font-bold flex items-center gap-2 text-emerald-400 tracking-wider">
                  <DollarSign className="w-4.5 h-4.5 text-emerald-400" />
                  TOTAL DEPOSIT
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-black text-emerald-400 font-mono tracking-tight break-all">
                ${getCalculatedTotalDeposit()}
              </div>
              {internalTransfers.length > 0 && (
                <div className="text-xs font-mono text-slate-400 flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <span className="flex items-center gap-1 text-purple-300">
                    <Send className="w-3.5 h-3.5" />
                    you earn this deposit for 240 days:
                  </span>
                  <span className="text-emerald-300 font-bold">
                    +${internalTransfers.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Row 3: Live Real-Time Accrued Yield & Daily Rate */}
            <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#0B152C] via-[#081226] to-[#060D1E] border border-amber-500/40 space-y-2.5 shadow-xl hover:border-amber-400/70 transition-all">
              <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
                <span className="uppercase font-bold flex items-center gap-2 text-amber-300 tracking-wider">
                  <TrendingUp className="w-4.5 h-4.5 text-amber-400" />
                  TOTAL EARNED PROFIT
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  TICKING LIVE
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-black text-amber-300 font-mono tabular-nums tracking-tight break-all">
                ${liveEarnedProfit.toFixed(6)}
              </div>
              <div className="text-xs font-mono text-slate-400 flex items-center justify-between pt-2 border-t border-slate-800/80">
                <span className="flex items-center gap-1 text-slate-400">
                  Daily Yield Rate (24h Profit):
                </span>
                <span className="text-emerald-400 font-bold">
                  +${getCalculatedDailyProfit()}/day
                </span>
              </div>
            </div>

          </div>

          {/* QUICK ACTIONS HUB */}
          <div className="p-6 rounded-3xl bg-[#070D1D] border border-slate-800 shadow-xl space-y-4">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Customer Quick Action Hub
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                onClick={onOpenDeposit}
                className="p-3.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-95 shadow-md shadow-emerald-950/30"
              >
                <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                <span>DEPOSIT FUNDS</span>
              </button>

              <button
                onClick={() => onOpenWithdraw && onOpenWithdraw(liveEarnedProfit)}
                className="p-3.5 rounded-2xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-95 shadow-md shadow-cyan-950/30"
              >
                <ArrowUpRight className="w-4 h-4 text-cyan-400" />
                <span>WITHDRAW EARNINGS</span>
              </button>

              {onOpenInternalTransfer && (
                <button
                  onClick={onOpenInternalTransfer}
                  className="p-3.5 rounded-2xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 text-purple-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-95 shadow-md shadow-purple-950/30"
                >
                  <Send className="w-4 h-4 text-purple-400" />
                  <span>INTERNAL TRANSFER</span>
                </button>
              )}

              <button
                onClick={() => {
                  const el = document.getElementById('withdrawal-history-section');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                  } else if (onOpenWithdraw) {
                    onOpenWithdraw();
                  }
                }}
                className="p-3.5 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-95 shadow-md shadow-amber-950/30"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                <span>WITHDRAW HISTORY</span>
              </button>
            </div>
          </div>

          {/* MAIN PROFILE DETAILS SECTION */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Col (2 cols): Detailed Account Information */}
            <div className="lg:col-span-2 p-6 sm:p-8 rounded-3xl bg-[#070D1D] border border-slate-800 space-y-6 shadow-xl">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white uppercase font-mono">
                      Account Credentials & Identity
                    </h2>
                    <p className="text-xs text-slate-400 font-mono">
                      Verified customer sign-in details & profile attributes
                    </p>
                  </div>
                </div>

                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-xl flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  VERIFIED
                </span>
              </div>

              {/* Data Table / Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                
                {/* Full Name */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[11px] uppercase block">Customer Name</span>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-cyan-400" />
                    <span>
                      {currentUser.firstName ? `${currentUser.firstName} ${currentUser.lastName || ''}` : 'Customer'}
                    </span>
                  </div>
                </div>

                {/* Signed-in Email */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[11px] uppercase block">Signed-In Email</span>
                  <div className="text-sm font-bold text-emerald-300 flex items-center gap-2 truncate">
                    <Mail className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{currentUser.email}</span>
                  </div>
                </div>

                {/* Account ID */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px] uppercase block">Account ID</span>
                    <button
                      onClick={() => handleCopy(currentUser?.id || '', 'accId')}
                      className="text-[10px] font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'accId' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedField === 'accId' ? 'COPIED' : 'COPY'}</span>
                    </button>
                  </div>
                  <div className="text-xs font-semibold text-cyan-300 break-all select-all pt-0.5">
                    {currentUser?.id || 'N/A'}
                  </div>
                </div>

                {/* Referral Code */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px] uppercase block">Referral Code</span>
                    <button
                      onClick={() => handleCopy(currentUser.referralCode || 'DC-CLIENT', 'ref')}
                      className="text-[10px] font-bold text-amber-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'ref' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedField === 'ref' ? 'COPIED' : 'COPY'}</span>
                    </button>
                  </div>
                  <div className="text-sm font-bold text-amber-300 pt-0.5">
                    {currentUser.referralCode || 'DC-CLIENT'}
                  </div>
                </div>

                {/* Member Since */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[11px] uppercase block">Registration Date</span>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-400" />
                    <span>
                      {new Date(currentUser.createdAt || Date.now()).toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                </div>

                {/* Security Status */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[11px] uppercase block">Security Clearance</span>
                  <div className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>2FA & Google Auth Enabled</span>
                  </div>
                </div>

              </div>

            </div>

            {/* Right Col (1 col): Security & Referral Overview */}
            <div className="space-y-6">
              
              {/* Card 1: Referral Link Share */}
              <div className="p-6 rounded-3xl bg-[#070D1D] border border-slate-800 space-y-4 shadow-xl">
                <div className="flex items-center gap-2.5 text-amber-300 font-mono text-xs font-bold uppercase">
                  <Award className="w-4 h-4 text-amber-400" />
                  <span>Customer Referral Program</span>
                </div>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">
                  Share your unique referral link to earn tiered commissions on client deposits.
                </p>

                <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                  <span className="text-[10px] font-mono text-slate-400 block uppercase">Your Referral Link</span>
                  <div className="flex items-center justify-between gap-2 font-mono text-xs text-cyan-300 overflow-hidden">
                    <span className="truncate">
                      {window.location.origin}/?ref={currentUser.referralCode || 'DC-CLIENT'}
                    </span>
                    <button
                      onClick={() => handleCopy(`${window.location.origin}/?ref=${currentUser.referralCode || 'DC-CLIENT'}`, 'link')}
                      className="p-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 transition-colors shrink-0 cursor-pointer"
                      title="Copy link"
                    >
                      {copiedField === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Institutional Protection */}
              <div className="p-6 rounded-3xl bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-cyan-500/30 space-y-3 shadow-xl">
                <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold uppercase">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  <span>Institutional Fund Protection</span>
                </div>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">
                  All customer principal deposits are held in segregated cold wallets backed by multi-signature cryptographic proof.
                </p>
              </div>

            </div>

          </div>

          {/* ACTIVE DEPOSITS & CONTRACTS TABLE */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#070D1D] border border-slate-800 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white uppercase font-mono">
                    Active Investment Deposits ({allCombinedDeposits.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Contracts generating real-time interest stream
                  </p>
                </div>
              </div>

              <button
                onClick={onOpenDeposit}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-xs transition-all cursor-pointer active:scale-95 shadow-md shadow-emerald-500/20"
              >
                + New Deposit
              </button>
            </div>

            {allCombinedDeposits.length === 0 ? (
              <div className="text-center py-10 text-slate-400 font-mono text-xs space-y-3">
                <p>No active investment deposits found for this customer account.</p>
                <button
                  onClick={onOpenDeposit}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-xs shadow-md cursor-pointer hover:brightness-110"
                >
                  Create First Deposit Cycle
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                      <th className="pb-3 font-semibold">Deposit ID</th>
                      <th className="pb-3 font-semibold">Amount</th>
                      <th className="pb-3 font-semibold">Plan</th>
                      <th className="pb-3 font-semibold">Daily Rate</th>
                      <th className="pb-3 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {allCombinedDeposits.map((dep) => (
                      <tr key={dep.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 text-cyan-300 font-semibold">{dep.id.slice(0, 8)}...</td>
                        <td className="py-3 text-emerald-400 font-bold">${(parseFloat(dep.principalAmount || (dep as any).amount || '0') || 0).toFixed(2)}</td>
                        <td className="py-3 text-white uppercase font-bold">{dep.planName || 'Standard'}</td>
                        <td className="py-3 text-amber-300 font-bold">
                          {dep.dailyYieldPercent ? Number(dep.dailyYieldPercent).toFixed(3) : (getPlanRates(parseFloat(dep.principalAmount || (dep as any).amount || '0')).dailyYieldPercent).toFixed(3)}%
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            dep.status === 'APPROVED' || dep.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                            dep.status === 'PENDING' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {dep.status}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400">
                          {new Date(dep.startTime || Date.now()).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* INTERNAL TRANSFERS RECEIVED FROM ADMIN */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#070D1D] border border-slate-800 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/30">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white uppercase font-mono flex items-center gap-2">
                    Internal Transfers Received ({internalTransfers.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Admin dollar allocations credited directly to your email account balance
                  </p>
                </div>
              </div>

              {internalTransfers.length > 0 && (
                <span className="px-3 py-1 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold">
                  Total Received: ${internalTransfers.reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0).toFixed(4)}
                </span>
              )}
            </div>

            {internalTransfers.length === 0 ? (
              <div className="text-center py-8 text-slate-400 font-mono text-xs space-y-2">
                <p>No internal transfers received for {currentUser.email} yet.</p>
                <p className="text-[11px] text-slate-500">
                  Dollars transferred by Admin via Internal Transfer to your email will instantly reflect in your Total Deposit balance and be listed here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                      <th className="pb-3 font-semibold">Transfer ID</th>
                      <th className="pb-3 font-semibold">Sender</th>
                      <th className="pb-3 font-semibold">Amount</th>
                      <th className="pb-3 font-semibold">Wallet Type</th>
                      <th className="pb-3 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Note / Purpose</th>
                      <th className="pb-3 font-semibold">Date & Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {internalTransfers.map((tx) => (
                      <tr key={tx.id || tx.transferId} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 text-cyan-300 font-bold">{tx.transferId || tx.id}</td>
                        <td className="py-3 text-slate-300">{tx.fromUserEmail || 'Admin System'}</td>
                        <td className="py-3 text-emerald-400 font-bold text-sm">
                          +${parseFloat(tx.amount || 0).toFixed(4)}
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">
                            {tx.toWalletType?.replace('_', ' ') || 'MAIN WALLET'}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                            {tx.status || 'SUCCESS'}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400 max-w-[180px] truncate">
                          {tx.note || 'Admin Internal Credit'}
                        </td>
                        <td className="py-3 text-slate-400">
                          {new Date(tx.createdAt || Date.now()).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* USER WITHDRAWAL HISTORY SECTION */}
          <div id="withdrawal-history-section" className="p-6 sm:p-8 rounded-3xl bg-[#070D1D] border border-slate-800 space-y-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white uppercase font-mono flex items-center gap-2">
                    Withdrawal History ({displayWithdrawals.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    All submitted withdrawal requests and payout status tracking for {currentUser?.email}
                  </p>
                </div>
              </div>

              <button
                onClick={onOpenWithdraw}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs transition-all cursor-pointer active:scale-95 shadow-md shadow-amber-500/20"
              >
                + Request Withdrawal
              </button>
            </div>

            {/* WITHDRAWAL SUMMARY STATS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Requested</span>
                <p className="text-lg font-extrabold text-amber-400">${totalRequestedUSD.toFixed(2)} USD</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Approved & Disbursed</span>
                <p className="text-lg font-extrabold text-emerald-400">${totalApprovedUSD.toFixed(2)} USD</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Pending Approval</span>
                <p className="text-lg font-extrabold text-cyan-400">${totalPendingUSD.toFixed(2)} USD</p>
              </div>
            </div>

            {/* BOLD NOTICE */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-emerald-950/90 border border-emerald-500/50 shadow-lg text-center">
              <p className="text-sm font-mono text-emerald-300">
                <strong className="font-bold text-emerald-300 tracking-wide">
                  Your withdraw approved in 24-48 hours
                </strong>
              </p>
            </div>

            {displayWithdrawals.length === 0 ? (
              <div className="text-center py-8 text-slate-400 font-mono text-xs space-y-3">
                <p>No withdrawal requests submitted yet for {currentUser?.email}.</p>
                <button
                  onClick={onOpenWithdraw}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-teal-500 text-black font-bold text-xs shadow-md cursor-pointer hover:brightness-110"
                >
                  Submit First Withdrawal
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                      <th className="pb-3 font-semibold">Withdrawal Ref</th>
                      <th className="pb-3 font-semibold">Amount</th>
                      <th className="pb-3 font-semibold">Gateway / Network</th>
                      <th className="pb-3 font-semibold">Destination Account</th>
                      <th className="pb-3 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Submitted Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {displayWithdrawals.map((wd) => (
                      <tr key={wd.id || wd.txHash} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 text-cyan-300 font-bold">{wd.id || wd.txHash || 'WD-REQ'}</td>
                        <td className="py-3 text-emerald-400 font-bold text-sm">
                          ${parseFloat(wd.amount || 0).toFixed(2)} USD
                        </td>
                        <td className="py-3 text-slate-300 uppercase font-bold">
                          {wd.cryptoNetwork || wd.gateway || 'USDT'}
                        </td>
                        <td className="py-3 text-slate-400 max-w-[200px] truncate">
                          {wd.destinationAddr || wd.accountNumber || wd.number || 'Standard Wallet'}
                        </td>
                        <td className="py-3">
                          <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                            wd.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                            wd.status === 'REJECTED' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                            'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                          }`}>
                            {wd.status || 'PENDING'}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400">
                          {new Date(wd.createdAt || wd.startTime || Date.now()).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
};
