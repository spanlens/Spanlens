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
      model_prices: {
        Row: {
          completion_price_per_1m: number
          created_at: string
          id: string
          model: string
          prompt_price_per_1m: number
          provider: string
          updated_at: string
        }
        Insert: {
          completion_price_per_1m: number
          created_at?: string
          id?: string
          model: string
          prompt_price_per_1m: number
          provider: string
          updated_at?: string
        }
        Update: {
          completion_price_per_1m?: number
          created_at?: string
          id?: string
          model?: string
          prompt_price_per_1m?: number
          provider?: string
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
      prompt_versions: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
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
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          project_id: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          project_id?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          project_id?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          api_key_id: string
          completion_tokens: number
          cost_usd: number | null
          created_at: string
          error_message: string | null
          flags: Json
          has_security_flags: boolean | null
          id: string
          latency_ms: number
          model: string
          organization_id: string
          project_id: string
          prompt_tokens: number
          prompt_version_id: string | null
          provider: string
          provider_key_id: string | null
          proxy_overhead_ms: number | null
          request_body: Json | null
          response_body: Json | null
          response_flags: Json
          span_id: string | null
          status_code: number
          total_tokens: number
          trace_id: string | null
        }
        Insert: {
          api_key_id: string
          completion_tokens?: number
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          flags?: Json
          has_security_flags?: boolean | null
          id?: string
          latency_ms: number
          model: string
          organization_id: string
          project_id: string
          prompt_tokens?: number
          prompt_version_id?: string | null
          provider: string
          provider_key_id?: string | null
          proxy_overhead_ms?: number | null
          request_body?: Json | null
          response_body?: Json | null
          response_flags?: Json
          span_id?: string | null
          status_code: number
          total_tokens?: number
          trace_id?: string | null
        }
        Update: {
          api_key_id?: string
          completion_tokens?: number
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          flags?: Json
          has_security_flags?: boolean | null
          id?: string
          latency_ms?: number
          model?: string
          organization_id?: string
          project_id?: string
          prompt_tokens?: number
          prompt_version_id?: string | null
          provider?: string
          provider_key_id?: string | null
          proxy_overhead_ms?: number | null
          request_body?: Json | null
          response_body?: Json | null
          response_flags?: Json
          span_id?: string | null
          status_code?: number
          total_tokens?: number
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_provider_key_id_fkey"
            columns: ["provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "spans_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
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
          delivered_at: string
          duration_ms: number | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          status: string
          webhook_id: string
        }
        Insert: {
          delivered_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          status: string
          webhook_id: string
        }
        Update: {
          delivered_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
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
      detect_anomaly_stats: {
        Args: {
          p_obs_start: string
          p_org_id: string
          p_project_id?: string
          p_ref_start: string
        }
        Returns: {
          model: string
          obs_all_count: number
          obs_cost_count: number
          obs_cost_mean: number
          obs_error_rate: number
          obs_latency_count: number
          obs_latency_mean: number
          provider: string
          ref_all_count: number
          ref_cost_count: number
          ref_cost_mean: number
          ref_cost_stddev: number
          ref_error_rate: number
          ref_error_stddev: number
          ref_latency_count: number
          ref_latency_mean: number
          ref_latency_stddev: number
        }[]
      }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      postgres_fdw_disconnect: { Args: { "": string }; Returns: boolean }
      postgres_fdw_disconnect_all: { Args: never; Returns: boolean }
      postgres_fdw_get_connections: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      postgres_fdw_handler: { Args: never; Returns: unknown }
      prune_logs_by_retention: { Args: never; Returns: Json }
      security_summary: {
        Args: { p_hours?: number; p_org_id: string }
        Returns: {
          count: number
          flag_type: string
          pattern: string
        }[]
      }
      stats_models: {
        Args: {
          p_from?: string
          p_org_id: string
          p_project_id?: string
          p_to?: string
        }
        Returns: {
          avg_latency_ms: number
          error_rate: number
          model: string
          provider: string
          requests: number
          total_cost_usd: number
        }[]
      }
      stats_overview: {
        Args: {
          p_from?: string
          p_org_id: string
          p_project_id?: string
          p_to?: string
        }
        Returns: {
          avg_latency_ms: number
          completion_tokens: number
          error_requests: number
          prompt_tokens: number
          success_requests: number
          total_cost_usd: number
          total_requests: number
          total_tokens: number
        }[]
      }
      stats_timeseries: {
        Args: {
          p_from?: string
          p_granularity?: string
          p_org_id: string
          p_project_id?: string
          p_to?: string
        }
        Returns: {
          cost: number
          day: string
          errors: number
          requests: number
          tokens: number
        }[]
      }
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

A new version of Supabase CLI is available: v2.95.4 (currently installed v2.90.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
