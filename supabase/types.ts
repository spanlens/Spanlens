Connecting to db 5432
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alert_deliveries: {
        Row: {
          alert_id: string
          channel_id: string
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          payload: Json | null
          status: string
        }
        Insert: {
          alert_id: string
          channel_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          payload?: Json | null
          status: string
        }
        Update: {
          alert_id?: string
          channel_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_deliveries_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deliveries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "notification_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          cooldown_minutes: number
          created_at: string
          id: string
          is_active: boolean
          last_triggered_at: string | null
          name: string
          organization_id: string
          project_id: string | null
          threshold: number
          type: string
          updated_at: string
          window_minutes: number
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name: string
          organization_id: string
          project_id?: string | null
          threshold: number
          type: string
          updated_at?: string
          window_minutes?: number
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name?: string
          organization_id?: string
          project_id?: string | null
          threshold?: number
          type?: string
          updated_at?: string
          window_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      anomaly_acks: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string | null
          id: string
          kind: string
          model: string
          organization_id: string
          project_id: string | null
          provider: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          id?: string
          kind: string
          model: string
          organization_id: string
          project_id?: string | null
          provider: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          id?: string
          kind?: string
          model?: string
          organization_id?: string
          project_id?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_acks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomaly_acks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      anomaly_events: {
        Row: {
          baseline_mean: number
          baseline_stddev: number
          confidence: string | null
          current_value: number
          detected_at: string
          detected_on: string
          deviations: number
          id: string
          kind: string
          model: string
          organization_id: string
          provider: string
          reference_count: number
          sample_count: number
        }
        Insert: {
          baseline_mean: number
          baseline_stddev: number
          confidence?: string | null
          current_value: number
          detected_at?: string
          detected_on: string
          deviations: number
          id?: string
          kind: string
          model: string
          organization_id: string
          provider: string
          reference_count: number
          sample_count: number
        }
        Update: {
          baseline_mean?: number
          baseline_stddev?: number
          confidence?: string | null
          current_value?: number
          detected_at?: string
          detected_on?: string
          deviations?: number
          id?: string
          kind?: string
          model?: string
          organization_id?: string
          provider?: string
          reference_count?: number
          sample_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      attn_dismissals: {
        Row: {
          card_key: string
          created_at: string
          organization_id: string
          user_id: string
        }
        Insert: {
          card_key: string
          created_at?: string
          organization_id: string
          user_id: string
        }
        Update: {
          card_key?: string
          created_at?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attn_dismissals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          organization_id: string
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id: string
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_downgrade_notifications: {
        Row: {
          created_at: string
          id: string
          stage: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stage: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stage?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_downgrade_notifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_job_runs: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          id: string
          job_name: string
          ran_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name: string
          ran_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name?: string
          ran_at?: string
          status?: string
        }
        Relationships: []
      }
      dataset_items: {
        Row: {
          created_at: string
          dataset_id: string
          expected_output: string | null
          id: string
          input: Json
          organization_id: string
          source_request_id: string | null
        }
        Insert: {
          created_at?: string
          dataset_id: string
          expected_output?: string | null
          id?: string
          input: Json
          organization_id: string
          source_request_id?: string | null
        }
        Update: {
          created_at?: string
          dataset_id?: string
          expected_output?: string | null
          id?: string
          input?: Json
          organization_id?: string
          source_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dataset_items_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataset_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "datasets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_results: {
        Row: {
          created_at: string
          dataset_item_id: string | null
          eval_run_id: string
          id: string
          judge_cost_usd: number
          judge_tokens: number
          organization_id: string
          reasoning: string | null
          request_id: string | null
          score: number
        }
        Insert: {
          created_at?: string
          dataset_item_id?: string | null
          eval_run_id: string
          id?: string
          judge_cost_usd?: number
          judge_tokens?: number
          organization_id: string
          reasoning?: string | null
          request_id?: string | null
          score: number
        }
        Update: {
          created_at?: string
          dataset_item_id?: string | null
          eval_run_id?: string
          id?: string
          judge_cost_usd?: number
          judge_tokens?: number
          organization_id?: string
          reasoning?: string | null
          request_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "eval_results_dataset_item_id_fkey"
            columns: ["dataset_item_id"]
            isOneToOne: false
            referencedRelation: "dataset_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_results_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          avg_score: number | null
          completed_at: string | null
          created_by: string | null
          dataset_id: string | null
          error: string | null
          evaluator_id: string
          id: string
          organization_id: string
          prompt_version_id: string
          sample_from: string | null
          sample_size: number
          sample_to: string | null
          scored_count: number
          source: string
          started_at: string
          status: string
          total_cost_usd: number
        }
        Insert: {
          avg_score?: number | null
          completed_at?: string | null
          created_by?: string | null
          dataset_id?: string | null
          error?: string | null
          evaluator_id: string
          id?: string
          organization_id: string
          prompt_version_id: string
          sample_from?: string | null
          sample_size: number
          sample_to?: string | null
          scored_count?: number
          source?: string
          started_at?: string
          status?: string
          total_cost_usd?: number
        }
        Update: {
          avg_score?: number | null
          completed_at?: string | null
          created_by?: string | null
          dataset_id?: string | null
          error?: string | null
          evaluator_id?: string
          id?: string
          organization_id?: string
          prompt_version_id?: string
          sample_from?: string | null
          sample_size?: number
          sample_to?: string | null
          scored_count?: number
          source?: string
          started_at?: string
          status?: string
          total_cost_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_evaluator_id_fkey"
            columns: ["evaluator_id"]
            isOneToOne: false
            referencedRelation: "evaluators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluators: {
        Row: {
          archived_at: string | null
          config: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          prompt_name: string
          type: string
        }
        Insert: {
          archived_at?: string | null
          config: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          prompt_name: string
          type?: string
        }
        Update: {
          archived_at?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          prompt_name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluators_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_results: {
        Row: {
          cost_a_usd: number
          cost_b_usd: number
          created_at: string
          dataset_item_id: string
          error_a: string | null
          error_b: string | null
          experiment_id: string
          id: string
          latency_a_ms: number | null
          latency_b_ms: number | null
          organization_id: string
          output_a: string | null
          output_b: string | null
          reasoning_a: string | null
          reasoning_b: string | null
          score_a: number | null
          score_b: number | null
          tokens_a: number
          tokens_b: number
        }
        Insert: {
          cost_a_usd?: number
          cost_b_usd?: number
          created_at?: string
          dataset_item_id: string
          error_a?: string | null
          error_b?: string | null
          experiment_id: string
          id?: string
          latency_a_ms?: number | null
          latency_b_ms?: number | null
          organization_id: string
          output_a?: string | null
          output_b?: string | null
          reasoning_a?: string | null
          reasoning_b?: string | null
          score_a?: number | null
          score_b?: number | null
          tokens_a?: number
          tokens_b?: number
        }
        Update: {
          cost_a_usd?: number
          cost_b_usd?: number
          created_at?: string
          dataset_item_id?: string
          error_a?: string | null
          error_b?: string | null
          experiment_id?: string
          id?: string
          latency_a_ms?: number | null
          latency_b_ms?: number | null
          organization_id?: string
          output_a?: string | null
          output_b?: string | null
          reasoning_a?: string | null
          reasoning_b?: string | null
          score_a?: number | null
          score_b?: number | null
          tokens_a?: number
          tokens_b?: number
        }
        Relationships: [
          {
            foreignKeyName: "experiment_results_dataset_item_id_fkey"
            columns: ["dataset_item_id"]
            isOneToOne: false
            referencedRelation: "dataset_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_results_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          avg_score_a: number | null
          avg_score_b: number | null
          completed_at: string | null
          completed_items: number
          created_by: string | null
          dataset_id: string
          error: string | null
          evaluator_id: string | null
          id: string
          name: string
          organization_id: string
          prompt_name: string
          run_model: string
          run_provider: string
          started_at: string
          status: string
          total_cost_usd: number
          total_items: number
          version_a_id: string
          version_b_id: string
        }
        Insert: {
          avg_score_a?: number | null
          avg_score_b?: number | null
          completed_at?: string | null
          completed_items?: number
          created_by?: string | null
          dataset_id: string
          error?: string | null
          evaluator_id?: string | null
          id?: string
          name: string
          organization_id: string
          prompt_name: string
          run_model: string
          run_provider: string
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_items?: number
          version_a_id: string
          version_b_id: string
        }
        Update: {
          avg_score_a?: number | null
          avg_score_b?: number | null
          completed_at?: string | null
          completed_items?: number
          created_by?: string | null
          dataset_id?: string
          error?: string | null
          evaluator_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          prompt_name?: string
          run_model?: string
          run_provider?: string
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_items?: number
          version_a_id?: string
          version_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_evaluator_id_fkey"
            columns: ["evaluator_id"]
            isOneToOne: false
            referencedRelation: "evaluators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_version_a_id_fkey"
            columns: ["version_a_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_version_b_id_fkey"
            columns: ["version_b_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      human_evals: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          organization_id: string
          prompt_version_id: string | null
          raw_score: number | null
          request_id: string
          reviewer_id: string
          score: number
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          organization_id: string
          prompt_version_id?: string | null
          raw_score?: number | null
          request_id: string
          reviewer_id: string
          score: number
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          prompt_version_id?: string | null
          raw_score?: number | null
          request_id?: string
          reviewer_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "human_evals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "human_evals_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      model_price_history: {
        Row: {
          cache_read_price_per_1m: number | null
          cache_write_price_per_1m: number | null
          change_kind: string
          changed_at: string
          changed_by: string | null
          completion_price_per_1m: number
          id: string
          model: string
          model_price_id: string
          prompt_price_per_1m: number
          provider: string
        }
        Insert: {
          cache_read_price_per_1m?: number | null
          cache_write_price_per_1m?: number | null
          change_kind: string
          changed_at?: string
          changed_by?: string | null
          completion_price_per_1m: number
          id?: string
          model: string
          model_price_id: string
          prompt_price_per_1m: number
          provider: string
        }
        Update: {
          cache_read_price_per_1m?: number | null
          cache_write_price_per_1m?: number | null
          change_kind?: string
          changed_at?: string
          changed_by?: string | null
          completion_price_per_1m?: number
          id?: string
          model?: string
          model_price_id?: string
          prompt_price_per_1m?: number
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_price_history_model_price_id_fkey"
            columns: ["model_price_id"]
            isOneToOne: false
            referencedRelation: "model_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      model_prices: {
        Row: {
          cache_read_price_per_1m: number | null
          cache_write_price_per_1m: number | null
          completion_price_per_1m: number
          created_at: string
          effective_from: string
          id: string
          model: string
          prompt_price_per_1m: number
          provider: string
          updated_at: string
        }
        Insert: {
          cache_read_price_per_1m?: number | null
          cache_write_price_per_1m?: number | null
          completion_price_per_1m: number
          created_at?: string
          effective_from?: string
          id?: string
          model: string
          prompt_price_per_1m: number
          provider: string
          updated_at?: string
        }
        Update: {
          cache_read_price_per_1m?: number | null
          cache_write_price_per_1m?: number | null
          completion_price_per_1m?: number
          created_at?: string
          effective_from?: string
          id?: string
          model?: string
          prompt_price_per_1m?: number
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      model_recommendations: {
        Row: {
          cost_ratio: number
          created_at: string
          current_model: string
          current_provider: string
          effective_from: string
          id: string
          max_avg_completion_tokens: number
          max_avg_prompt_tokens: number
          reason: string
          suggested_model: string
          suggested_provider: string
          updated_at: string
        }
        Insert: {
          cost_ratio: number
          created_at?: string
          current_model: string
          current_provider: string
          effective_from?: string
          id?: string
          max_avg_completion_tokens: number
          max_avg_prompt_tokens: number
          reason: string
          suggested_model: string
          suggested_provider: string
          updated_at?: string
        }
        Update: {
          cost_ratio?: number
          created_at?: string
          current_model?: string
          current_provider?: string
          effective_from?: string
          id?: string
          max_avg_completion_tokens?: number
          max_avg_prompt_tokens?: number
          reason?: string
          suggested_model?: string
          suggested_provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_channels: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          organization_id: string
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          organization_id: string
          target: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          organization_id?: string
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          allow_overage: boolean
          created_at: string
          id: string
          last_security_alert_at: string | null
          leak_detection_enabled: boolean
          name: string
          overage_cap_multiplier: number
          owner_id: string
          paddle_customer_id: string | null
          plan: string
          quota_warning_100_sent_at: string | null
          quota_warning_80_sent_at: string | null
          security_alert_enabled: boolean
          stale_key_alerts_enabled: boolean
          stale_key_threshold_days: number
          updated_at: string
        }
        Insert: {
          allow_overage?: boolean
          created_at?: string
          id?: string
          last_security_alert_at?: string | null
          leak_detection_enabled?: boolean
          name: string
          overage_cap_multiplier?: number
          owner_id: string
          paddle_customer_id?: string | null
          plan?: string
          quota_warning_100_sent_at?: string | null
          quota_warning_80_sent_at?: string | null
          security_alert_enabled?: boolean
          stale_key_alerts_enabled?: boolean
          stale_key_threshold_days?: number
          updated_at?: string
        }
        Update: {
          allow_overage?: boolean
          created_at?: string
          id?: string
          last_security_alert_at?: string | null
          leak_detection_enabled?: boolean
          name?: string
          overage_cap_multiplier?: number
          owner_id?: string
          paddle_customer_id?: string | null
          plan?: string
          quota_warning_100_sent_at?: string | null
          quota_warning_80_sent_at?: string | null
          security_alert_enabled?: boolean
          stale_key_alerts_enabled?: boolean
          stale_key_threshold_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          security_block_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          security_block_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          security_block_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_ab_experiments: {
        Row: {
          concluded_at: string | null
          created_by: string | null
          ends_at: string | null
          id: string
          organization_id: string
          project_id: string | null
          prompt_name: string
          started_at: string
          status: string
          traffic_split: number
          version_a_id: string
          version_b_id: string
          winner_version_id: string | null
        }
        Insert: {
          concluded_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string
          organization_id: string
          project_id?: string | null
          prompt_name: string
          started_at?: string
          status?: string
          traffic_split?: number
          version_a_id: string
          version_b_id: string
          winner_version_id?: string | null
        }
        Update: {
          concluded_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string
          organization_id?: string
          project_id?: string | null
          prompt_name?: string
          started_at?: string
          status?: string
          traffic_split?: number
          version_a_id?: string
          version_b_id?: string
          winner_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_ab_experiments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_ab_experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_ab_experiments_version_a_id_fkey"
            columns: ["version_a_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_ab_experiments_version_b_id_fkey"
            columns: ["version_b_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_ab_experiments_winner_version_id_fkey"
            columns: ["winner_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_archived: boolean
          metadata: Json
          name: string
          organization_id: string
          project_id: string | null
          variables: Json
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          metadata?: Json
          name: string
          organization_id: string
          project_id?: string | null
          variables?: Json
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          metadata?: Json
          name?: string
          organization_id?: string
          project_id?: string | null
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_key_leak_scans: {
        Row: {
          details: Json | null
          id: string
          notified_at: string | null
          organization_id: string
          provider_key_id: string
          result: string
          scanned_at: string
        }
        Insert: {
          details?: Json | null
          id?: string
          notified_at?: string | null
          organization_id: string
          provider_key_id: string
          result: string
          scanned_at?: string
        }
        Update: {
          details?: Json | null
          id?: string
          notified_at?: string | null
          organization_id?: string
          provider_key_id?: string
          result?: string
          scanned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_key_leak_scans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_key_leak_scans_provider_key_id_fkey"
            columns: ["provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_keys: {
        Row: {
          api_key_id: string
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          provider: string
          provider_metadata: Json
          updated_at: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          provider: string
          provider_metadata?: Json
          updated_at?: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          provider?: string
          provider_metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_keys_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          count: number
          created_at: string
          key: string
          window_key: string
        }
        Insert: {
          count?: number
          created_at?: string
          key: string
          window_key: string
        }
        Update: {
          count?: number
          created_at?: string
          key?: string
          window_key?: string
        }
        Relationships: []
      }
      recommendation_applications: {
        Row: {
          applied_at: string
          id: string
          model: string
          note: string | null
          organization_id: string
          provider: string
          suggested_model: string
          suggested_provider: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          id?: string
          model: string
          note?: string | null
          organization_id: string
          provider: string
          suggested_model: string
          suggested_provider: string
          user_id: string
        }
        Update: {
          applied_at?: string
          id?: string
          model?: string
          note?: string | null
          organization_id?: string
          provider?: string
          suggested_model?: string
          suggested_provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_notifications: {
        Row: {
          confidence_level: string
          id: string
          organization_id: string
          recommendation_key: string
          savings_usd: number
          sent_at: string
        }
        Insert: {
          confidence_level: string
          id?: string
          organization_id: string
          recommendation_key: string
          savings_usd: number
          sent_at?: string
        }
        Update: {
          confidence_level?: string
          id?: string
          organization_id?: string
          recommendation_key?: string
          savings_usd?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      requests_fallback: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_retry_at: string | null
          organization_id: string | null
          payload: Json
          retry_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          organization_id?: string | null
          payload: Json
          retry_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          organization_id?: string | null
          payload?: Json
          retry_count?: number
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_filters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      spans: {
        Row: {
          completion_tokens: number
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          error_message: string | null
          external_parent_span_id: string | null
          external_span_id: string | null
          id: string
          input: Json | null
          metadata: Json | null
          name: string
          organization_id: string
          output: Json | null
          parent_span_id: string | null
          prompt_tokens: number
          request_id: string | null
          span_type: string
          started_at: string
          status: string
          total_tokens: number
          trace_id: string
        }
        Insert: {
          completion_tokens?: number
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          external_parent_span_id?: string | null
          external_span_id?: string | null
          id?: string
          input?: Json | null
          metadata?: Json | null
          name: string
          organization_id: string
          output?: Json | null
          parent_span_id?: string | null
          prompt_tokens?: number
          request_id?: string | null
          span_type?: string
          started_at?: string
          status?: string
          total_tokens?: number
          trace_id: string
        }
        Update: {
          completion_tokens?: number
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          external_parent_span_id?: string | null
          external_span_id?: string | null
          id?: string
          input?: Json | null
          metadata?: Json | null
          name?: string
          organization_id?: string
          output?: Json | null
          parent_span_id?: string | null
          prompt_tokens?: number
          request_id?: string | null
          span_type?: string
          started_at?: string
          status?: string
          total_tokens?: number
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spans_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_overage_charges: {
        Row: {
          charged_at: string
          completed_at: string | null
          error_message: string | null
          id: string
          overage_quantity: number
          overage_requests: number
          paddle_response: Json | null
          period_end: string
          period_start: string
          price_id: string
          status: string
          subscription_id: string
        }
        Insert: {
          charged_at?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          overage_quantity: number
          overage_requests: number
          paddle_response?: Json | null
          period_end: string
          period_start: string
          price_id: string
          status?: string
          subscription_id: string
        }
        Update: {
          charged_at?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          overage_quantity?: number
          overage_requests?: number
          paddle_response?: Json | null
          period_end?: string
          period_start?: string
          price_id?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_overage_charges_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json | null
          organization_id: string
          paddle_customer_id: string
          paddle_price_id: string
          paddle_subscription_id: string
          past_due_since: string | null
          plan: string
          status: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          paddle_customer_id: string
          paddle_price_id: string
          paddle_subscription_id: string
          past_due_since?: string | null
          plan: string
          status: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          paddle_customer_id?: string
          paddle_price_id?: string
          paddle_subscription_id?: string
          past_due_since?: string | null
          plan?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      traces: {
        Row: {
          api_key_id: string | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          error_message: string | null
          external_trace_id: string | null
          id: string
          metadata: Json | null
          name: string
          organization_id: string
          project_id: string
          span_count: number
          started_at: string
          status: string
          total_cost_usd: number
          total_tokens: number
          updated_at: string
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          external_trace_id?: string | null
          id?: string
          metadata?: Json | null
          name: string
          organization_id: string
          project_id: string
          span_count?: number
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          external_trace_id?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          organization_id?: string
          project_id?: string
          span_count?: number
          started_at?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "traces_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          completion_tokens: number
          cost_usd: number
          created_at: string
          date: string
          id: string
          model: string
          organization_id: string
          project_id: string
          prompt_tokens: number
          provider: string
          request_count: number
          total_tokens: number
          updated_at: string
        }
        Insert: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          date: string
          id?: string
          model: string
          organization_id: string
          project_id: string
          prompt_tokens?: number
          provider: string
          request_count?: number
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          date?: string
          id?: string
          model?: string
          organization_id?: string
          project_id?: string
          prompt_tokens?: number
          provider?: string
          request_count?: number
          total_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          accepted_at: string
          document: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          document: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          document?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          onboarded_at: string | null
          role: string | null
          updated_at: string
          use_case: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          onboarded_at?: string | null
          role?: string | null
          updated_at?: string
          use_case?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          onboarded_at?: string | null
          role?: string | null
          updated_at?: string
          use_case?: string | null
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          company: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
          status: string
          use_case: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          email: string
          id?: string
          name?: string | null
          status?: string
          use_case?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
          status?: string
          use_case?: string | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          delivered_at: string
          duration_ms: number | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          next_retry_at: string | null
          payload: Json | null
          status: string
          webhook_id: string
        }
        Insert: {
          attempt_count?: number
          delivered_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          next_retry_at?: string | null
          payload?: Json | null
          status: string
          webhook_id: string
        }
        Update: {
          attempt_count?: number
          delivered_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
          next_retry_at?: string | null
          payload?: Json | null
          status?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          events: string[]
          id: string
          is_active: boolean
          name: string
          organization_id: string
          secret: string
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          secret: string
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_usage_daily: { Args: { target_date: string }; Returns: number }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_key: string }
        Returns: boolean
      }
      get_model_aggregates: {
        Args: {
          p_organization_id: string
          p_status_codes: number[]
          p_window_start: string
        }
        Returns: {
          avg_completion_tokens: number
          avg_prompt_tokens: number
          model: string
          provider: string
          sample_count: number
          total_cost_usd: number
        }[]
      }
      get_model_percentiles: {
        Args: {
          p_model: string
          p_organization_id: string
          p_provider: string
          p_window_start: string
        }
        Returns: {
          p50_completion: number
          p50_prompt: number
          p95_completion: number
          p95_prompt: number
          p99_completion: number
          p99_prompt: number
          sample_count: number
        }[]
      }
      get_model_prior_window_cost: {
        Args: {
          p_model: string
          p_organization_id: string
          p_provider: string
          p_window_end: string
          p_window_start: string
        }
        Returns: number
      }
      get_prompts_quality_sparklines: {
        Args: {
          p_buckets?: number
          p_hours?: number
          p_names: string[]
          p_org_id: string
        }
        Returns: {
          bucket_index: number
          bucket_start: string
          prompt_name: string
          quality_score: number
        }[]
      }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      link_otlp_span_parents: {
        Args: { p_trace_id: string }
        Returns: undefined
      }
      prune_cron_job_runs: { Args: never; Returns: undefined }
      prune_logs_by_retention: { Args: never; Returns: Json }
      prune_rate_limit_buckets: { Args: never; Returns: number }
      set_spanlens_actor: { Args: { actor_id: string }; Returns: undefined }
    }
    Enums: {
      org_role: "admin" | "editor" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      org_role: ["admin", "editor", "viewer"],
    },
  },
} as const

A new version of Supabase CLI is available: v2.100.1 (currently installed v2.90.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
