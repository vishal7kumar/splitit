import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { listUserActivity, markActivityAsRead } from "../../api/activity";
import { formatDate } from "../../lib/formatDate";

export default function ActivityPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const activityLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const {
    data: activityPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["user-activity"],
    queryFn: ({ pageParam }) => listUserActivity({ limit: 20, cursor: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
  });

  const markReadMutation = useMutation({
    mutationFn: markActivityAsRead,
    onSuccess: () => {
      // Invalidate the count key to reset badge in layout header
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  // Mark activities as read when the component mounts
  useEffect(() => {
    markReadMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    const node = activityLoadMoreRef.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "160px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const activity = activityPages?.pages.flatMap((page) => page.items) || [];
  const activityText = (summary: string, actorName: string) =>
    summary.startsWith(actorName) ? summary.slice(actorName.length).trim() : summary;

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Activity</h1>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">Loading activity history...</p>
        </div>
      ) : activity.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center shadow-sm">
          <p className="text-gray-500 text-sm mb-1">No activity yet.</p>
          <p className="text-gray-400 text-xs">Create groups, add expenses, or settle balances to build history!</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {activity.map((item) => {
            const isActorYou = item.user_id === user?.id;
            const content = (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="break-words text-gray-600 flex-1 min-w-0">
                  {!item.is_involved && (
                    <span className="mb-1 inline-block rounded bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                      You were not involved
                    </span>
                  )}
                  <div className="text-gray-900">
                    <span className="font-semibold text-gray-950">
                      {isActorYou ? "You" : item.user_name}
                    </span>{" "}
                    <span className="text-gray-700">{activityText(item.summary, item.user_name)}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-gray-400 font-medium">
                    {item.group_name || "Group"} &middot; {formatDate(item.created_at)}
                  </div>
                </div>
                {item.is_new && (
                  <span className="shrink-0 inline-flex items-center rounded-full bg-blue-100 border border-blue-200 px-2 py-0.5 text-[9px] font-extrabold text-blue-700 uppercase tracking-wider animate-pulse">
                    New
                  </span>
                )}
              </div>
            );

            const itemClass = `block border rounded-xl p-4 transition-all duration-200 cursor-pointer ${
              item.is_new
                ? "bg-blue-50/30 border-blue-200 shadow-sm"
                : "bg-white border-gray-200 hover:shadow-md hover:border-gray-300"
            }`;

            return (
              <li key={item.id}>
                {item.expense_id ? (
                  <Link
                    to={`/groups/${item.group_id}/expenses/${item.expense_id}`}
                    className={itemClass}
                  >
                    {content}
                  </Link>
                ) : (
                  <Link
                    to={`/groups/${item.group_id}`}
                    className={itemClass}
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={activityLoadMoreRef} className="h-6" />
      {isFetchingNextPage && (
        <p className="text-center text-xs text-gray-400 mt-2">Loading more activities...</p>
      )}
    </div>
  );
}
