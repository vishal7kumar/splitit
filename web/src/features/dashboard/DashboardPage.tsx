import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { getTotalBalance } from "../../api/settlements";
import { formatCurrency } from "../../lib/currency";

export default function DashboardPage() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["total-balance"],
    queryFn: getTotalBalance,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-gray-600 mb-6">
        Welcome back, {user?.name || user?.email}!
      </p>

      {data && (
        <>
          <div className="border rounded p-4 mb-6">
            <p className="text-sm text-gray-500">Overall balance</p>
            <p
              className={`text-3xl font-bold ${
                data.total_balance >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {data.total_balance >= 0 ? "+" : ""}
              {formatCurrency(data.groups[0]?.currency || "INR", data.total_balance)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {data.total_balance > 0
                ? "Others owe you overall"
                : data.total_balance < 0
                  ? "You owe others overall"
                  : "All settled up!"}
            </p>
          </div>

          {data.groups.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Per group</h2>
              <ul className="space-y-2">
                {data.groups.map((g) => (
                  <li key={g.group_id}>
                    <Link
                      to={`/groups/${g.group_id}`}
                      className="flex items-center justify-between border rounded p-3 hover:bg-gray-50"
                    >
                      <div>
                        <span className="font-medium">{g.name}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 ml-2">
                          {g.currency}
                        </span>
                      </div>
                      <span
                        className={`font-medium ${
                          g.balance >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {g.balance > 0 ? "+" : ""}
                        {formatCurrency(g.currency, g.balance)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
