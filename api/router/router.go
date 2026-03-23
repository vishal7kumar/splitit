package router

import (
	"splitit-api/handlers"
	"splitit-api/middleware"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

func Setup(db *sqlx.DB) *gin.Engine {
	r := gin.Default()

	auth := &handlers.AuthHandler{DB: db}

	api := r.Group("/api")
	{
		api.POST("/auth/register", auth.Register)
		api.POST("/auth/login", auth.Login)
		api.POST("/auth/logout", auth.Logout)

		protected := api.Group("")
		protected.Use(middleware.RequireAuth())
		{
			protected.GET("/auth/me", auth.Me)

			groups := &handlers.GroupHandler{DB: db}
			protected.POST("/groups", groups.Create)
			protected.GET("/groups", groups.List)
			protected.GET("/groups/:id", groups.Get)
			protected.PUT("/groups/:id", groups.Update)
			protected.DELETE("/groups/:id", groups.Delete)

			members := &handlers.MemberHandler{DB: db}
			protected.POST("/groups/:id/members", members.Add)
			protected.DELETE("/groups/:id/members/:userId", members.Remove)

			expenses := &handlers.ExpenseHandler{DB: db}
			protected.POST("/groups/:id/expenses", expenses.Create)
			protected.GET("/groups/:id/expenses", expenses.List)
			protected.GET("/groups/:id/expenses/:eid", expenses.Get)
			protected.PUT("/groups/:id/expenses/:eid", expenses.Update)
			protected.DELETE("/groups/:id/expenses/:eid", expenses.Delete)

			balances := &handlers.BalanceHandler{DB: db}
			protected.GET("/groups/:id/balances", balances.GroupBalances)
			protected.GET("/user/total-balance", balances.TotalBalance)

			settlements := &handlers.SettlementHandler{DB: db}
			protected.POST("/groups/:id/settlements", settlements.Create)
			protected.GET("/groups/:id/settlements", settlements.List)
		}
	}

	return r
}
