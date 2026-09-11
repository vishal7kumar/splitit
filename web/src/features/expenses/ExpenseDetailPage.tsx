import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGroup, type GroupMember } from "../../api/groups";
import {
  addExpenseComment,
  deleteExpense,
  getExpense,
  type ExpenseSplit,
} from "../../api/expenses";
import { formatDate, formatExpenseDate } from "../../lib/formatDate";
import { useAuth } from "../auth/useAuth";
import { formatCurrency } from "../../lib/currency";

export default function ExpenseDetailPage() {
  const { id, eid } = useParams<{ id: string; eid: string }>();
  const groupId = Number(id);
  const expenseId = Number(eid);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const { data: groupData, isLoading: groupLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery({
    queryKey: ["expense", groupId, expenseId],
    queryFn: () => getExpense(groupId, expenseId),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => addExpenseComment(groupId, expenseId, body),
    onSuccess: () => {
      setComment("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["expense", groupId, expenseId] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) =>
      setError(err.response?.data?.error || "Failed to add comment"),
  });

  const delExpense = useMutation({
    mutationFn: () => deleteExpense(groupId, expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      navigate(`/groups/${groupId}`);
    },
  });

  function handleComment(e: FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) {
      setError("Comment cannot be empty");
      return;
    }
    addComment.mutate(body);
  }

  if (groupLoading || expenseLoading || !groupData || !expenseData) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading expense details...</p>
      </div>
    );
  }

  const { group, members } = groupData;
  const { expense, splits, comments = [], history = [] } = expenseData;
  const memberMap = Object.fromEntries(
    members.map((m: GroupMember) => [m.user_id, m])
  );
  const payerName = expense.paid_by === user?.id ? "You" : (memberMap[expense.paid_by]?.name || "Unknown");

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <div className="mb-6">
        <Link
          to={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors font-medium cursor-pointer"
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
          Back to {group.name}
        </Link>
        
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mt-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-gray-900 dark:text-white">
              {expense.description || "Untitled expense"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span className="text-xl font-extrabold text-gray-900 dark:text-white">
                {formatCurrency(group.currency, expense.amount)}
              </span>
              <span>&middot;</span>
              <span>Paid by <span className="font-semibold text-gray-800 dark:text-gray-200">{payerName}</span></span>
              <span>&middot;</span>
              <span>{formatExpenseDate(expense.date)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/groups/${groupId}/expenses/${expenseId}/edit`}
              className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-semibold shadow-sm transition-all duration-200 cursor-pointer"
            >
              Edit
            </Link>
            <button
              type="button"
              disabled={delExpense.isPending}
              onClick={() => {
                if (confirm("Delete this expense? You can restore it from Activity for 30 days.")) delExpense.mutate();
              }}
              className="text-xs sm:text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-rose-400 hover:border-red-300 dark:hover:border-red-700 px-3.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 transition-all duration-200 cursor-pointer font-medium"
            >
              {delExpense.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>

      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 pb-2 mb-4">Details</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Paid by</dt>
            <dd className="font-semibold text-sm text-gray-900 dark:text-white mt-0.5">{payerName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Expense date</dt>
            <dd className="font-semibold text-sm text-gray-900 dark:text-white mt-0.5">{formatExpenseDate(expense.date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Added on</dt>
            <dd className="font-semibold text-sm text-gray-900 dark:text-white mt-0.5">{formatDate(expense.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Updated on</dt>
            <dd className="font-semibold text-sm text-gray-900 dark:text-white mt-0.5">{formatDate(expense.updated_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 pb-2 mb-2">Who owes</h2>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {splits.map((split: ExpenseSplit) => {
            const memberName = split.user_id === user?.id ? "You" : (memberMap[split.user_id]?.name || "Unknown");
            return (
              <li
                key={split.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 flex items-center justify-center text-[10px] font-bold select-none">
                    {memberName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <span className="font-medium text-gray-800 dark:text-gray-200">{memberName}</span>
                </div>
                <span className="font-bold text-gray-900 dark:text-white">
                  {formatCurrency(group.currency, split.share_amount)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 pb-2 mb-2">Transaction history</h2>
        {history.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-xs italic py-3">No history yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {history.map((entry) => (
              <li key={entry.id} className="py-3 text-sm">
                <div className="font-medium text-gray-800 dark:text-gray-200">{entry.summary}</div>
                <div className="text-gray-400 dark:text-gray-500 text-xs mt-0.5 font-medium">
                  {entry.user_name} &middot; {formatDate(entry.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 pb-2 mb-4">Comments</h2>
        
        <form onSubmit={handleComment} className="mb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-all duration-200 min-h-24 shadow-xs"
          />
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-rose-400 px-3 py-2 rounded-lg text-xs font-medium mt-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={addComment.isPending}
            className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-60 transition-all duration-200 cursor-pointer shadow-sm"
          >
            {addComment.isPending ? "Adding..." : "Add comment"}
          </button>
        </form>

        {comments.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-xs italic py-2">No comments yet.</p>
        ) : (
          <ul className="space-y-3 mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            {comments.map((item) => (
              <li key={item.id} className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 rounded-xl p-3.5 text-sm shadow-2xs space-y-1">
                <div className="flex justify-between items-center gap-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">{item.user_name}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 leading-relaxed text-sm mt-1">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
