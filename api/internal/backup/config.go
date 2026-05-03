package backup

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Enabled         bool
	Stage           string
	Bucket          string
	Region          string
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Timeout         time.Duration
	RetentionCount  int
	DatabaseURL     string
}

func LoadConfig(databaseURL string) Config {
	return Config{
		Enabled:         strings.EqualFold(os.Getenv("BACKUP_ENABLED"), "true"),
		Stage:           normalizeStage(firstNonEmpty(os.Getenv("BACKUP_STAGE"), os.Getenv("APP_ENV"), os.Getenv("ENV"), "DEV")),
		Bucket:          firstNonEmpty(os.Getenv("BACKUP_BUCKET"), "splitit_db_backup"),
		Region:          firstNonEmpty(os.Getenv("BACKUP_REGION"), "auto"),
		Endpoint:        os.Getenv("BACKUP_S3_ENDPOINT"),
		AccessKeyID:     os.Getenv("BACKUP_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("BACKUP_SECRET_ACCESS_KEY"),
		Timeout:         durationEnv("BACKUP_TIMEOUT", 30*time.Minute),
		RetentionCount:  intEnv("BACKUP_RETENTION_COUNT", 3),
		DatabaseURL:     databaseURL,
	}
}

func normalizeStage(stage string) string {
	switch strings.ToLower(strings.TrimSpace(stage)) {
	case "production", "prod":
		return "PROD"
	default:
		return "DEV"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}
