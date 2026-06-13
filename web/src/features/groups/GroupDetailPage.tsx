import { useState, useMemo, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGroup, addMember, removeMember, deleteGroup, updateGroup } from "../../api/groups";
import { listExpenses, deleteExpense, type Expense } from "../../api/expenses";
import {
  getGroupBalances,
  createSettlement,
} from "../../api/settlements";
import { useAuth } from "../auth/useAuth";
import { formatDate } from "../../lib/formatDate";
import { formatCurrency } from "../../lib/currency";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [settleDirection, setSettleDirection] = useState<"paid" | "received">("paid");
  const [settleOtherId, setSettleOtherId] = useState<number>(0);
  const [settleAmount, setSettleAmount] = useState("");
  const [settlePrompt, setSettlePrompt] = useState<{ to: number; amount: number } | null>(null);
  const [customSettleAmount, setCustomSettleAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"expenses" | "balances" | "settings" | "totals">("expenses");

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", groupId, search],
    queryFn: () =>
      listExpenses(groupId, {
        q: search || undefined,
      }),
  });

  const { data: balanceData } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: () => getGroupBalances(groupId),
  });

  const settle = useMutation({
    mutationFn: ({ paidBy, paidTo, amount }: { paidBy: number; paidTo: number; amount: number }) =>
      createSettlement(groupId, paidBy, paidTo, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["settlements", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      setSettleOtherId(0);
      setSettleAmount("");
    },
  });

  const add = useMutation({
    mutationFn: (email: string) => addMember(groupId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      setEmail("");
      setError("");
    },
    onError: () => setError("Could not add member — check the email"),
  });

  const remove = useMutation({
    mutationFn: (userId: number) => removeMember(groupId, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["group", groupId] }),
  });

  const del = useMutation({
    mutationFn: () => deleteGroup(groupId),
    onSuccess: () => navigate("/groups"),
  });

  const updateCurrency = useMutation({
    mutationFn: (currency: string) =>
      updateGroup(groupId, { name: data?.group.name || "", currency }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["group", groupId] }),
  });

  const delExpense = useMutation({
    mutationFn: (eid: number) => deleteExpense(groupId, eid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
    },
  });

  // Group expenses by Month (e.g. "June 2026")
  const groupedExpenses = useMemo(() => {
    const groups: { monthKey: string; monthLabel: string; items: Expense[] }[] = [];
    expenses.forEach((exp: Expense) => {
      const parts = exp.date.split("-");
      let monthLabel = "Unknown Month";
      let monthKey = "unknown";
      if (parts.length >= 2) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10) - 1; // 0-based
        const dateObj = new Date(Number(year), monthNum, 1);
        monthLabel = dateObj.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        monthKey = `${year}-${parts[1]}`;
      }
      
      let groupObj = groups.find((g) => g.monthKey === monthKey);
      if (!groupObj) {
        groupObj = { monthKey, monthLabel, items: [] };
        groups.push(groupObj);
      }
      groupObj.items.push(exp);
    });
    return groups;
  }, [expenses]);

  // List of all months that have expenses + current month
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    
    // Add current month as a default fallback
    const now = new Date();
    const fallbackMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    months.add(fallbackMonthKey);
    
    expenses.forEach((exp) => {
      const parts = exp.date.split("-");
      if (parts.length >= 2) {
        months.add(`${parts[0]}-${parts[1]}`);
      }
    });
    
    // Sort descending
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const currentMonthKey = (selectedMonth && availableMonths.includes(selectedMonth))
    ? selectedMonth
    : (availableMonths.length > 0 ? availableMonths[0] : "");

  const getMonthLabel = (monthKey: string) => {
    const parts = monthKey.split("-");
    if (parts.length !== 2) return monthKey;
    const date = new Date(Number(parts[0]), parseInt(parts[1], 10) - 1, 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const monthlyExpenses = useMemo(() => {
    if (!currentMonthKey) return [];
    return expenses.filter((exp) => exp.date.startsWith(currentMonthKey));
  }, [expenses, currentMonthKey]);

  const totalGroupSpend = useMemo(() => {
    return monthlyExpenses.reduce((sum, exp) => sum + Number(exp.amount), 0);
  }, [monthlyExpenses]);

  const memberSpends = useMemo(() => {
    if (!data) return [];
    return data.members.map((member) => {
      const amountPaid = monthlyExpenses
        .filter((exp) => exp.paid_by === member.user_id)
        .reduce((sum, exp) => sum + Number(exp.amount), 0);
      return {
        ...member,
        amountPaid,
      };
    }).sort((a, b) => b.amountPaid - a.amountPaid);
  }, [data, monthlyExpenses]);

  const myBalance = useMemo(() => {
    if (!balanceData || !balanceData.balances || !user) return 0;
    const myEntry = balanceData.balances.find((b: any) => b.user_id === user.id);
    return myEntry ? myEntry.balance : 0;
  }, [balanceData, user]);

  function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) add.mutate(email.trim());
  }

  if (isLoading || !data) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const { group, members } = data;
  const currentMember = members.find((m) => m.user_id === user?.id);
  const isAdmin = currentMember?.role === "admin";
  const memberMap = Object.fromEntries(members.map((m) => [m.user_id, m]));

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back to Groups Link */}
      <div className="mb-4">
        <Link
          to="/groups"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors font-medium cursor-pointer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            />
          </svg>
          Back to Groups
        </Link>
      </div>

      {/* Group Title and Actions */}
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-gray-900">{group.name}</h1>
          <p className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Currency: <span className="font-semibold text-gray-700">{group.currency}</span></span>
            {balanceData && (
              <>
                <span className="text-gray-300 sm:inline hidden">|</span>
                <span>
                  Your balance:{" "}
                  <span
                    className={`font-bold ${
                      myBalance > 0.005
                        ? "text-green-600"
                        : myBalance < -0.005
                          ? "text-red-600"
                          : "text-gray-500"
                    }`}
                  >
                    {myBalance > 0.005 ? "+" : ""}
                    {formatCurrency(group.currency, myBalance)}
                  </span>
                  <span className="text-xs text-gray-400 font-normal ml-1">
                    {myBalance > 0.005
                      ? "(others owe you)"
                      : myBalance < -0.005
                        ? "(you owe others)"
                        : "(settled up)"}
                  </span>
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center">
          <Link
            to={`/groups/${groupId}/add`}
            className="w-full sm:w-auto bg-blue-600 text-white text-center px-4 py-2 rounded text-sm hover:bg-blue-700 font-semibold shadow-sm transition-colors cursor-pointer"
          >
            Add Expense
          </Link>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto overflow-y-hidden scrollbar-none">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 pb-0.5" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("expenses")}
            className={`
              flex items-center gap-2 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 cursor-pointer shrink-0
              ${activeTab === "expenses"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 17.25 4.5H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            Expenses
          </button>
          <button
            onClick={() => setActiveTab("balances")}
            className={`
              flex items-center gap-2 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 cursor-pointer shrink-0
              ${activeTab === "balances"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            Balances
          </button>
          <button
            onClick={() => setActiveTab("totals")}
            className={`
              flex items-center gap-2 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 cursor-pointer shrink-0
              ${activeTab === "totals"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z"
              />
            </svg>
            Totals
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`
              flex items-center gap-2 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-all duration-200 cursor-pointer shrink-0
              ${activeTab === "settings"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
            Settings
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "expenses" && (
        <section className="mb-8">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search expenses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 shadow-sm"
            />
          </div>

          {expenses.length === 0 ? (
            <p className="text-gray-400 text-sm italic py-4">No expenses yet.</p>
          ) : (
            <div className="space-y-6">
              {groupedExpenses.map((groupObj) => (
                <div key={groupObj.monthKey} className="relative">
                  <div className="sticky top-0 bg-gray-50/95 backdrop-blur-xs py-2 z-10 flex items-center justify-between border-b border-gray-200 mb-3">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      {groupObj.monthLabel}
                    </span>
                    <span className="text-xs text-gray-400 font-semibold">
                      {groupObj.items.length} {groupObj.items.length === 1 ? "expense" : "expenses"}
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {groupObj.items.map((exp: Expense) => (
                      <li
                        key={exp.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/groups/${groupId}/expenses/${exp.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            navigate(`/groups/${groupId}/expenses/${exp.id}`);
                          }
                        }}
                        className="flex flex-col gap-3 border border-gray-200 bg-white rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-gray-300 sm:flex-row sm:items-center sm:justify-between transition-all duration-200 shadow-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold break-words text-gray-900 text-sm">
                            {exp.description || "Untitled"}
                          </span>
                          <div className="break-words text-xs text-gray-500 mt-1 font-medium">
                            <span className="font-semibold text-gray-700">
                              {exp.paid_by === user?.id ? "You" : (memberMap[exp.paid_by]?.name || "Unknown")}
                            </span>{" "}
                            paid{" "}
                            <span className="font-semibold text-gray-700">
                              {formatCurrency(group.currency, exp.amount)}
                            </span>{" "}
                            &middot; {formatDate(exp.date)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5 border-t border-gray-100 pt-2 sm:border-t-0 sm:pt-0 items-center">
                          <Link
                            to={`/groups/${groupId}/expenses/${exp.id}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 text-gray-500 hover:text-blue-650 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                            </svg>
                          </Link>
                          <button
                            disabled={delExpense.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Delete this expense?"))
                                delExpense.mutate(exp.id);
                            }}
                            className="p-1.5 text-gray-500 hover:text-red-650 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                            title="Delete"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                              stroke="currentColor"
                              className="w-4 h-4"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m14.74 9-.346 9m-4.788 0L9 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "balances" && balanceData && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-4 text-gray-900">Balances</h2>
          <ul className="space-y-3 mb-6">
            {balanceData.balances.map((b) => (
              <li key={b.user_id} className="flex justify-between items-center gap-3 text-sm border border-gray-200 bg-white rounded-xl p-3.5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300">
                <span className="min-w-0 break-words text-gray-700 font-medium">{b.user_id === user?.id ? "You" : b.name}</span>
                <span className={`font-bold ${b.balance >= 0.005 ? "text-green-600" : b.balance < -0.005 ? "text-red-600" : "text-gray-500"}`}>
                  {b.balance > 0.005 ? "+" : ""}{formatCurrency(group.currency, b.balance)}
                </span>
              </li>
            ))}
          </ul>

          {balanceData.debts.length > 0 && (
            <>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2.5 mt-6">Simplified debts</h3>
              <ul className="space-y-3 mb-6">
                {balanceData.debts.map((d, i) => (
                  <li key={i} className="flex flex-col gap-3 text-sm border border-gray-200 bg-white rounded-xl p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between hover:shadow-md hover:border-gray-300 transition-all duration-200">
                    <span className="min-w-0 break-words text-gray-700">
                      <span className="font-semibold text-gray-950">{d.from === user?.id ? "You" : d.from_name}</span>
                      {d.from === user?.id ? " owe " : " owes "}
                      <span className="font-semibold text-gray-950">{d.to === user?.id ? "You" : d.to_name}</span>
                      {" "}<span className="font-bold text-gray-900">{formatCurrency(group.currency, d.amount)}</span>
                    </span>
                    {d.from === user?.id && (
                      settlePrompt?.to === d.to ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-gray-50 pt-2 sm:border-t-0 sm:pt-0">
                          <button
                            disabled={settle.isPending}
                            onClick={() => {
                              settle.mutate({ paidBy: user!.id, paidTo: d.to, amount: d.amount });
                              setSettlePrompt(null);
                              setCustomSettleAmount("");
                            }}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-lg font-semibold disabled:opacity-50 transition-colors cursor-pointer shadow-sm"
                          >
                            {settle.isPending ? "Paying..." : `Full (${formatCurrency(group.currency, d.amount)})`}
                          </button>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Amount"
                              value={customSettleAmount}
                              onChange={(e) => setCustomSettleAmount(e.target.value)}
                              className="w-20 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all"
                            />
                            <button
                              disabled={settle.isPending}
                              onClick={() => {
                                const amt = parseFloat(customSettleAmount);
                                if (amt > 0) {
                                  settle.mutate({ paidBy: user!.id, paidTo: d.to, amount: amt });
                                  setSettlePrompt(null);
                                  setCustomSettleAmount("");
                                }
                              }}
                              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg font-semibold disabled:opacity-50 transition-colors cursor-pointer shadow-sm"
                            >
                              {settle.isPending ? "..." : "Pay"}
                            </button>
                          </div>
                          <button
                            onClick={() => { setSettlePrompt(null); setCustomSettleAmount(""); }}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1 font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSettlePrompt({ to: d.to, amount: d.amount })}
                          className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm transition-colors cursor-pointer"
                        >
                          Settle up
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Manual settle */}
          <div className="border border-gray-200 bg-white rounded-xl p-5 shadow-sm mt-6">
            <h3 className="text-sm font-bold text-gray-900 mb-3.5">Record a payment</h3>
            <div className="flex gap-3 flex-col sm:flex-row">
              <select
                value={settleDirection}
                onChange={(e) => setSettleDirection(e.target.value as "paid" | "received")}
                className="w-full sm:w-44 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
              >
                <option value="paid">You paid</option>
                <option value="received">You received from</option>
              </select>
              <select
                value={settleOtherId}
                onChange={(e) => setSettleOtherId(Number(e.target.value))}
                className="min-w-0 flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
              >
                <option value={0}>Select member...</option>
                {members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Amount"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                className="w-full min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm sm:w-28 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white"
              />
              <button
                disabled={settle.isPending}
                onClick={() => {
                  if (settleOtherId && settleAmount) {
                    const amt = parseFloat(settleAmount);
                    if (amt > 0) {
                      const paidBy = settleDirection === "paid" ? user!.id : settleOtherId;
                      const paidTo = settleDirection === "paid" ? settleOtherId : user!.id;
                      settle.mutate({ paidBy, paidTo, amount: amt });
                    }
                  }
                }}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm cursor-pointer shrink-0"
              >
                {settle.isPending ? "Recording..." : "Record"}
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "totals" && (
        <section className="mb-8 space-y-6">
          {/* Month Selector & Overall Stats */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Monthly Spending Totals</h2>
                <p className="text-xs text-gray-500 mt-0.5">Summary of total spends by the group and individual members.</p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="totals-month-select" className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Month:
                </label>
                <select
                  id="totals-month-select"
                  value={currentMonthKey}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer text-gray-800 font-semibold transition-all"
                >
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {getMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <hr className="border-gray-100" />

            <div className="py-2 text-center sm:text-left">
              <span className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Total Group Spending</span>
              <span className="block text-3xl font-extrabold text-gray-900 mt-1">
                {formatCurrency(group.currency, totalGroupSpend)}
              </span>
              <p className="text-xs text-gray-400 mt-1 font-medium">
                For {getMonthLabel(currentMonthKey)} &middot; {monthlyExpenses.length} {monthlyExpenses.length === 1 ? "expense" : "expenses"}
              </p>
            </div>
          </div>

          {/* Individual Spends */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Spends by Member</h3>
            
            {totalGroupSpend === 0 ? (
              <p className="text-gray-400 text-xs italic py-2">No spends recorded for this month.</p>
            ) : (
              <ul className="space-y-4.5">
                {memberSpends.map((m) => {
                  const percentage = totalGroupSpend > 0 ? (m.amountPaid / totalGroupSpend) * 100 : 0;
                  return (
                    <li key={m.user_id} className="space-y-1.5">
                      <div className="flex justify-between items-center text-sm gap-2">
                        <span className="font-semibold text-gray-700 truncate">
                          {m.user_id === user?.id ? "You" : m.name}
                        </span>
                        <span className="font-bold text-gray-950 shrink-0">
                          {formatCurrency(group.currency, m.amountPaid)}
                        </span>
                      </div>
                      
                      {/* CSS progress bar */}
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                           className="bg-blue-600 h-full rounded-full transition-all duration-500"
                           style={{ width: `${percentage}%` }}
                        />
                      </div>
                      
                      <div className="flex justify-between text-[10px] text-gray-400 font-semibold">
                        <span>
                          {percentage.toFixed(1)}% of total
                        </span>
                        <span>
                          {monthlyExpenses.filter((e) => e.paid_by === m.user_id).length} paid
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {activeTab === "settings" && (
        <section className="mb-8 space-y-6">
          {/* Group Preferences Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-3.5">Group Preferences</h3>
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <span className="block text-sm font-semibold text-gray-700">Group Currency</span>
                <span className="text-xs text-gray-400 mt-0.5 font-medium">The currency used for calculating balances and new expenses.</span>
              </div>
              {isAdmin ? (
                <select
                  value={group.currency}
                  onChange={(e) => updateCurrency.mutate(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer transition-all"
                >
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              ) : (
                <span className="text-sm font-bold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-lg">{group.currency}</span>
              )}
            </div>
          </div>

          {/* Members Management Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-3.5">Members ({members.length})</h3>

            <form onSubmit={handleAddMember} className="flex flex-col gap-2.5 mb-4 sm:flex-row">
              <input
                type="email"
                placeholder="Add member by email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all"
                required
              />
              <button
                type="submit"
                disabled={add.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-all font-semibold shadow-sm cursor-pointer shrink-0"
              >
                {add.isPending ? "Adding..." : "Add"}
              </button>
            </form>
            {error && <p className="text-red-600 text-xs font-semibold mb-3">{error}</p>}

            <ul className="space-y-3">
              {members.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 border border-gray-200 bg-white rounded-xl p-3.5 shadow-2xs hover:shadow-xs transition-all"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 break-words">{m.user_id === user?.id ? "You" : m.name}</span>
                      {m.role === "admin" && (
                        <span className="text-[10px] bg-blue-50 border border-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider">
                          admin
                        </span>
                      )}
                    </div>
                    <span className="block break-all text-gray-400 text-xs mt-1 font-medium">{m.email}</span>
                  </div>
                  {isAdmin && m.user_id !== user?.id && (
                    <button
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(m.user_id)}
                      className="shrink-0 text-xs text-red-600 hover:text-red-800 font-bold disabled:opacity-50 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Danger Zone Card */}
          {isAdmin && (
            <div className="bg-red-50/50 border border-red-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-red-800 mb-1.5">Danger Zone</h3>
              <p className="text-xs text-red-600 mb-4 leading-relaxed font-medium">
                Deleting this group is permanent. All expenses, balances, and history will be permanently deleted.
              </p>
              <button
                disabled={del.isPending}
                onClick={() => {
                  if (confirm("Delete this group?")) del.mutate();
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 shadow-sm transition-colors cursor-pointer"
              >
                {del.isPending ? "Deleting..." : "Delete group"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
