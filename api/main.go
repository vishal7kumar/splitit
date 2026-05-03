package main

import (
	"context"
	"log"
	"os"

	"splitit-api/db"
	"splitit-api/internal/backup"
	"splitit-api/router"

	"github.com/joho/godotenv"
)

func main() {
	loadEnv()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	database, err := db.Connect(databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	backupConfig := backup.LoadConfig(databaseURL)
	if backupConfig.Enabled {
		objectStore, err := backup.NewS3Store(context.Background(), backupConfig)
		if err != nil {
			log.Fatalf("Failed to configure backup storage: %v", err)
		}
		backup.NewService(backupConfig, backup.PostgresStore{DB: database}, objectStore).Start(context.Background())
	}

	r := router.Setup(database)
	log.Printf("Server starting on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func loadEnv() {
	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "local"
	}

	files := []string{".env." + appEnv, ".env"}
	loaded := false
	for _, file := range files {
		if err := godotenv.Load(file); err == nil {
			log.Printf("Loaded %s", file)
			loaded = true
		}
	}

	if !loaded {
		log.Println("No env file found, using environment variables")
	}
}
