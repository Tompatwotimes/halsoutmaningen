export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          challenge_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          note: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          challenge_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          note?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          challenge_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          note?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      challenge_memberships: {
        Row: {
          active: boolean
          challenge_id: string
          created_at: string
          created_by: string | null
          id: string
          participation_end_date: string | null
          participation_start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          challenge_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          participation_end_date?: string | null
          participation_start_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          challenge_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          participation_end_date?: string | null
          participation_start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_memberships_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_penalty_definitions: {
        Row: {
          active: boolean
          challenge_id: string
          created_at: string
          display_name: string
          id: string
          penalty_type: string
          sort_order: number
          unlock_streak: number
          updated_at: string
          value: number
        }
        Insert: {
          active?: boolean
          challenge_id: string
          created_at?: string
          display_name: string
          id?: string
          penalty_type: string
          sort_order?: number
          unlock_streak: number
          updated_at?: string
          value: number
        }
        Update: {
          active?: boolean
          challenge_id?: string
          created_at?: string
          display_name?: string
          id?: string
          penalty_type?: string
          sort_order?: number
          unlock_streak?: number
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_penalty_definitions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          push_enabled: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date: string
          id?: string
          missed_day_cost: number
          name: string
          proof_required?: boolean
          push_enabled?: boolean
          required_minutes: number
          start_date: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string
          id?: string
          missed_day_cost?: number
          name?: string
          proof_required?: boolean
          push_enabled?: boolean
          required_minutes?: number
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_activity: {
        Row: {
          at: string
          challenge_id: string
          seq: number
        }
        Insert: {
          at?: string
          challenge_id: string
          seq: number
        }
        Update: {
          at?: string
          challenge_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_activity_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_attachments: {
        Row: {
          challenge_id: string
          created_at: string
          height: number | null
          id: string
          message_id: string
          mime_type: string
          position: number
          size_bytes: number
          storage_path: string
          width: number | null
        }
        Insert: {
          challenge_id: string
          created_at?: string
          height?: number | null
          id?: string
          message_id: string
          mime_type: string
          position: number
          size_bytes: number
          storage_path: string
          width?: number | null
        }
        Update: {
          challenge_id?: string
          created_at?: string
          height?: number | null
          id?: string
          message_id?: string
          mime_type?: string
          position?: number
          size_bytes?: number
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_attachments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_attachments_message_fk"
            columns: ["message_id", "challenge_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id", "challenge_id"]
          },
        ]
      }
      chat_message_likes: {
        Row: {
          challenge_id: string
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_likes_message_fk"
            columns: ["message_id", "challenge_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id", "challenge_id"]
          },
          {
            foreignKeyName: "chat_message_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string | null
          challenge_id: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          reply_to_message_id: string | null
          sender_type: string
          sender_user_id: string | null
          seq: number
          status: string
          training_entry_id: string | null
        }
        Insert: {
          body?: string | null
          challenge_id: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          reply_to_message_id?: string | null
          sender_type: string
          sender_user_id?: string | null
          seq?: never
          status?: string
          training_entry_id?: string | null
        }
        Update: {
          body?: string | null
          challenge_id?: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          reply_to_message_id?: string | null
          sender_type?: string
          sender_user_id?: string | null
          seq?: never
          status?: string
          training_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_fk"
            columns: ["reply_to_message_id", "challenge_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id", "challenge_id"]
          },
          {
            foreignKeyName: "chat_messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_training_entry_id_fkey"
            columns: ["training_entry_id"]
            isOneToOne: true
            referencedRelation: "training_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_read_state: {
        Row: {
          challenge_id: string
          last_read_message_id: string | null
          last_read_seq: number
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          last_read_message_id?: string | null
          last_read_seq?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          last_read_message_id?: string | null
          last_read_seq?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_read_state_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_read_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_read_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earned_penalties: {
        Row: {
          challenge_id: string
          created_at: string
          display_name: string
          earned_on_date: string
          id: string
          penalty_definition_id: string
          penalty_type: string
          spent_assignment_id: string | null
          status: string
          streak_run_start: string
          user_id: string
          value: number
        }
        Insert: {
          challenge_id: string
          created_at?: string
          display_name: string
          earned_on_date: string
          id?: string
          penalty_definition_id: string
          penalty_type: string
          spent_assignment_id?: string | null
          status?: string
          streak_run_start: string
          user_id: string
          value: number
        }
        Update: {
          challenge_id?: string
          created_at?: string
          display_name?: string
          earned_on_date?: string
          id?: string
          penalty_definition_id?: string
          penalty_type?: string
          spent_assignment_id?: string | null
          status?: string
          streak_run_start?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "earned_penalties_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earned_penalties_penalty_definition_id_fkey"
            columns: ["penalty_definition_id"]
            isOneToOne: false
            referencedRelation: "challenge_penalty_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earned_penalties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_event_views: {
        Row: {
          dismissed_at: string | null
          event_id: string
          first_seen_at: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          event_id: string
          first_seen_at?: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          event_id?: string
          first_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_master_event_views_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "game_master_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_event_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_events: {
        Row: {
          archive: boolean
          body_text: string
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          challenge_id: string
          created_at: string
          expires_at: string | null
          family: string
          id: string
          payload: Json
          severity: number
          starts_at: string
          status: string
          subject_user_id: string | null
          template_id: string | null
          title_text: string
          visibility: string
        }
        Insert: {
          archive?: boolean
          body_text: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          challenge_id: string
          created_at?: string
          expires_at?: string | null
          family: string
          id?: string
          payload?: Json
          severity: number
          starts_at?: string
          status?: string
          subject_user_id?: string | null
          template_id?: string | null
          title_text: string
          visibility: string
        }
        Update: {
          archive?: boolean
          body_text?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          challenge_id?: string
          created_at?: string
          expires_at?: string | null
          family?: string
          id?: string
          payload?: Json
          severity?: number
          starts_at?: string
          status?: string
          subject_user_id?: string | null
          template_id?: string | null
          title_text?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_master_events_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_events_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "game_master_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_memories: {
        Row: {
          callback_count: number
          challenge_id: string
          created_at: string
          earliest_callback_at: string | null
          expires_at: string | null
          fingerprint: string
          id: string
          importance: number
          memory_date: string
          memory_type: string
          payload: Json
          subject_user_id: string | null
        }
        Insert: {
          callback_count?: number
          challenge_id: string
          created_at?: string
          earliest_callback_at?: string | null
          expires_at?: string | null
          fingerprint: string
          id?: string
          importance: number
          memory_date: string
          memory_type: string
          payload?: Json
          subject_user_id?: string | null
        }
        Update: {
          callback_count?: number
          challenge_id?: string
          created_at?: string
          earliest_callback_at?: string | null
          expires_at?: string | null
          fingerprint?: string
          id?: string
          importance?: number
          memory_date?: string
          memory_type?: string
          payload?: Json
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_master_memories_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_memories_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_runs: {
        Row: {
          candidate_count: number
          challenge_id: string
          completed_at: string | null
          diagnostics: Json
          eligible_count: number
          id: string
          outcome: string
          selected_event_id: string | null
          source: string
          started_at: string
        }
        Insert: {
          candidate_count?: number
          challenge_id: string
          completed_at?: string | null
          diagnostics?: Json
          eligible_count?: number
          id?: string
          outcome: string
          selected_event_id?: string | null
          source: string
          started_at?: string
        }
        Update: {
          candidate_count?: number
          challenge_id?: string
          completed_at?: string | null
          diagnostics?: Json
          eligible_count?: number
          id?: string
          outcome?: string
          selected_event_id?: string | null
          source?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_master_runs_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_master_runs_selected_event_id_fkey"
            columns: ["selected_event_id"]
            isOneToOne: false
            referencedRelation: "game_master_events"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_settings: {
        Row: {
          archive_enabled: boolean
          challenge_id: string
          created_at: string
          enabled: boolean
          intensity: string
          private_roasts_enabled: boolean
          public_roasts_enabled: boolean
          updated_at: string
        }
        Insert: {
          archive_enabled?: boolean
          challenge_id: string
          created_at?: string
          enabled?: boolean
          intensity?: string
          private_roasts_enabled?: boolean
          public_roasts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          archive_enabled?: boolean
          challenge_id?: string
          created_at?: string
          enabled?: boolean
          intensity?: string
          private_roasts_enabled?: boolean
          public_roasts_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_master_settings_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: true
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      game_master_templates: {
        Row: {
          archive: boolean
          body_template: string
          cooldown_hours: number
          created_at: string
          enabled: boolean
          family: string
          final_weight: number
          id: string
          once_per_subject: boolean
          severity: number
          template_key: string
          title_template: string
          updated_at: string
          visibility: string
          weight: number
        }
        Insert: {
          archive?: boolean
          body_template: string
          cooldown_hours?: number
          created_at?: string
          enabled?: boolean
          family: string
          final_weight?: number
          id?: string
          once_per_subject?: boolean
          severity: number
          template_key: string
          title_template: string
          updated_at?: string
          visibility: string
          weight?: number
        }
        Update: {
          archive?: boolean
          body_template?: string
          cooldown_hours?: number
          created_at?: string
          enabled?: boolean
          family?: string
          final_weight?: number
          id?: string
          once_per_subject?: boolean
          severity?: number
          template_key?: string
          title_template?: string
          updated_at?: string
          visibility?: string
          weight?: number
        }
        Relationships: []
      }
      penalty_assignments: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          challenge_id: string
          created_at: string
          display_name: string
          earned_penalty_id: string
          from_user_id: string
          id: string
          penalty_type: string
          status: string
          target_date: string
          to_user_id: string
          value: number
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          challenge_id: string
          created_at?: string
          display_name: string
          earned_penalty_id: string
          from_user_id: string
          id?: string
          penalty_type: string
          status?: string
          target_date: string
          to_user_id: string
          value: number
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          challenge_id?: string
          created_at?: string
          display_name?: string
          earned_penalty_id?: string
          from_user_id?: string
          id?: string
          penalty_type?: string
          status?: string
          target_date?: string
          to_user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "penalty_assignments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalty_assignments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalty_assignments_earned_penalty_id_fkey"
            columns: ["earned_penalty_id"]
            isOneToOne: false
            referencedRelation: "earned_penalties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalty_assignments_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalty_assignments_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          outbox_id: string
          outcome: string | null
          sent_at: string | null
          status_code: number | null
          subscription_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          outbox_id: string
          outcome?: string | null
          sent_at?: string | null
          status_code?: number | null
          subscription_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          outbox_id?: string
          outcome?: string | null
          sent_at?: string | null
          status_code?: number | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "notification_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempt_count: number
          body: string
          category: string
          challenge_id: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          failed_at: string | null
          id: string
          last_error: string | null
          natural_key: string
          not_before: string
          recipient_id: string
          sent_at: string | null
          source_message_id: string | null
          tag: string
          title: string
          url: string
        }
        Insert: {
          attempt_count?: number
          body: string
          category: string
          challenge_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          natural_key: string
          not_before?: string
          recipient_id: string
          sent_at?: string | null
          source_message_id?: string | null
          tag: string
          title: string
          url: string
        }
        Update: {
          attempt_count?: number
          body?: string
          category?: string
          challenge_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          natural_key?: string
          not_before?: string
          recipient_id?: string
          sent_at?: string | null
          source_message_id?: string | null
          tag?: string
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          chat_all_messages: boolean
          chat_like: boolean
          chat_reply: boolean
          challenge_id: string
          daily_group_summary: boolean
          game_master: boolean
          personal_status: boolean
          straffbanken: boolean
          training_reminders: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_all_messages?: boolean
          chat_like?: boolean
          chat_reply?: boolean
          challenge_id: string
          daily_group_summary?: boolean
          game_master?: boolean
          personal_status?: boolean
          straffbanken?: boolean
          training_reminders?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_all_messages?: boolean
          chat_like?: boolean
          chat_reply?: boolean
          challenge_id?: string
          daily_group_summary?: boolean
          game_master?: boolean
          personal_status?: boolean
          straffbanken?: boolean
          training_reminders?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_path: string | null
          created_at: string
          display_name: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_path?: string | null
          created_at?: string
          display_name: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          retired_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          retired_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          retired_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retroactive_training_request_sessions: {
        Row: {
          activity: string | null
          created_at: string
          duration_minutes: number
          id: string
          note: string | null
          proof_height: number | null
          proof_mime_type: string | null
          proof_size_bytes: number | null
          proof_storage_path: string | null
          proof_width: number | null
          request_id: string
          sort_order: number
        }
        Insert: {
          activity?: string | null
          created_at?: string
          duration_minutes: number
          id?: string
          note?: string | null
          proof_height?: number | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_storage_path?: string | null
          proof_width?: number | null
          request_id: string
          sort_order?: number
        }
        Update: {
          activity?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          note?: string | null
          proof_height?: number | null
          proof_mime_type?: string | null
          proof_size_bytes?: number | null
          proof_storage_path?: string | null
          proof_width?: number | null
          request_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "retroactive_training_request_sessions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "retroactive_training_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      retroactive_training_requests: {
        Row: {
          challenge_date: string
          challenge_id: string
          created_at: string
          id: string
          participant_reason: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_date: string
          challenge_id: string
          created_at?: string
          id?: string
          participant_reason: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_date?: string
          challenge_id?: string
          created_at?: string
          id?: string
          participant_reason?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retroactive_training_requests_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_training_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_training_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_entries: {
        Row: {
          activity: string | null
          challenge_date: string
          challenge_id: string
          created_at: string
          duration_minutes: number
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidated_reason: string | null
          invalidated_reason_code: string | null
          note: string | null
          session_seq: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity?: string | null
          challenge_date: string
          challenge_id: string
          created_at?: string
          duration_minutes: number
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidated_reason?: string | null
          invalidated_reason_code?: string | null
          note?: string | null
          session_seq?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity?: string | null
          challenge_date?: string
          challenge_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidated_reason?: string | null
          invalidated_reason_code?: string | null
          note?: string | null
          session_seq?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_entries_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_entries_invalidated_by_fkey"
            columns: ["invalidated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_proofs: {
        Row: {
          challenge_id: string
          created_at: string
          height: number | null
          id: string
          mime_type: string
          position: number
          size_bytes: number
          storage_path: string
          training_entry_id: string
          user_id: string
          width: number | null
        }
        Insert: {
          challenge_id: string
          created_at?: string
          height?: number | null
          id?: string
          mime_type: string
          position?: number
          size_bytes: number
          storage_path: string
          training_entry_id: string
          user_id: string
          width?: number | null
        }
        Update: {
          challenge_id?: string
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string
          position?: number
          size_bytes?: number
          storage_path?: string
          training_entry_id?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_proofs_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_proofs_training_entry_id_fkey"
            columns: ["training_entry_id"]
            isOneToOne: false
            referencedRelation: "training_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_proofs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weight_competition_results: {
        Row: {
          challenge_id: string
          determined_at: string
          determined_by: string | null
          disclosed_at: string | null
          disclosed_by: string | null
          winner_percentage_change: number | null
          winner_user_id: string | null
        }
        Insert: {
          challenge_id: string
          determined_at?: string
          determined_by?: string | null
          disclosed_at?: string | null
          disclosed_by?: string | null
          winner_percentage_change?: number | null
          winner_user_id?: string | null
        }
        Update: {
          challenge_id?: string
          determined_at?: string
          determined_by?: string | null
          disclosed_at?: string | null
          disclosed_by?: string | null
          winner_percentage_change?: number | null
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weight_competition_results_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: true
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_competition_results_determined_by_fkey"
            columns: ["determined_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_competition_results_disclosed_by_fkey"
            columns: ["disclosed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_competition_results_winner_user_id_fkey"
            columns: ["winner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weight_entries: {
        Row: {
          challenge_id: string
          created_at: string
          entry_date: string
          id: string
          updated_at: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          challenge_id: string
          created_at?: string
          entry_date: string
          id?: string
          updated_at?: string
          user_id: string
          weight_kg: number
        }
        Update: {
          challenge_id?: string
          created_at?: string
          entry_date?: string
          id?: string
          updated_at?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "weight_entries_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weight_profiles: {
        Row: {
          challenge_id: string
          created_at: string
          is_weight_hidden: boolean
          official_final_recorded_at: string | null
          official_final_recorded_by: string | null
          official_final_weight_kg: number | null
          start_weight_first_saved_at: string | null
          start_weight_kg: number | null
          start_weight_locked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          is_weight_hidden?: boolean
          official_final_recorded_at?: string | null
          official_final_recorded_by?: string | null
          official_final_weight_kg?: number | null
          start_weight_first_saved_at?: string | null
          start_weight_kg?: number | null
          start_weight_locked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          is_weight_hidden?: boolean
          official_final_recorded_at?: string | null
          official_final_recorded_by?: string | null
          official_final_weight_kg?: number | null
          start_weight_first_saved_at?: string | null
          start_weight_kg?: number | null
          start_weight_locked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weight_profiles_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_profiles_official_final_recorded_by_fkey"
            columns: ["official_final_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weight_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _challenge_start_date_correction_check: {
        Args: { p_challenge_id: string; p_new_start_date: string }
        Returns: Json
      }
      _chat_attachment_readable: { Args: { p_path: string }; Returns: boolean }
      _create_chat_message: {
        Args: {
          p_attachments: Json
          p_body: string
          p_challenge_id: string
          p_message_id: string
          p_reply_to_message_id: string
        }
        Returns: {
          body: string | null
          challenge_id: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          reply_to_message_id: string | null
          sender_type: string
          sender_user_id: string | null
          seq: number
          status: string
          training_entry_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _game_master_candidates: {
        Args: { p_challenge_id: string }
        Returns: {
          family: string
          fingerprint: string
          payload: Json
          score: number
          subject_user_id: string
          visibility: string
        }[]
      }
      _game_master_escalation: {
        Args: { p_challenge_id: string }
        Returns: number
      }
      _game_master_intensity: {
        Args: { p_challenge_id: string }
        Returns: number
      }
      _game_master_render: {
        Args: { p_payload: Json; p_template: string }
        Returns: string
      }
      _game_master_score: {
        Args: {
          p_attention: number
          p_base: number
          p_final: number
          p_magnitude: number
          p_novelty: number
        }
        Returns: number
      }
      _game_master_tick_all: { Args: never; Returns: undefined }
      _game_master_validate_template: {
        Args: { p_text: string }
        Returns: boolean
      }
      _next_penalty_target_date: {
        Args: { p_challenge_id: string; p_to_user_id: string }
        Returns: string
      }
      _reconcile_earned_penalties: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: undefined
      }
      _retroactive_block_message: { Args: { p_chk: Json }; Returns: string }
      _retroactive_request_eligibility_check: {
        Args: {
          p_challenge_date: string
          p_challenge_id: string
          p_user_id: string
        }
        Returns: Json
      }
      _run_game_master_pulse: {
        Args: {
          p_challenge_id: string
          p_forced_roll?: number
          p_source: string
        }
        Returns: string
      }
      _weight_is_hidden: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: boolean
      }
      _weight_winner_is_hidden: {
        Args: { p_challenge_id: string }
        Returns: boolean
      }
      add_training_session: {
        Args: {
          p_activity?: string
          p_challenge_id: string
          p_duration_minutes: number
          p_note?: string
        }
        Returns: {
          activity: string | null
          challenge_date: string
          challenge_id: string
          created_at: string
          duration_minutes: number
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidated_reason: string | null
          invalidated_reason_code: string | null
          note: string | null
          session_seq: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "training_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_retroactive_registration: {
        Args: { p_admin_note?: string; p_request_id: string }
        Returns: Json
      }
      archive_challenge: {
        Args: { p_challenge_id: string }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_penalty: {
        Args: { p_earned_penalty_id: string; p_to_user_id: string }
        Returns: Json
      }
      cancel_game_master_event: {
        Args: { p_event_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_penalty_assignment: {
        Args: { p_assignment_id: string; p_reason: string }
        Returns: Json
      }
      cancel_retroactive_registration: {
        Args: { p_request_id: string }
        Returns: Json
      }
      challenge_current_date: {
        Args: { p_challenge_id: string }
        Returns: string
      }
      challenge_daily_requirement: {
        Args: {
          p_base_minutes: number
          p_penalty_type: string
          p_penalty_value: number
        }
        Returns: {
          min_minutes_per_session: number
          required_sessions: number
          required_total_minutes: number
        }[]
      }
      challenge_day_states: {
        Args: { p_challenge_id: string; p_user_id?: string }
        Returns: {
          challenge_date: string
          min_minutes_per_session: number
          penalty_display_name: string
          penalty_from_user_id: string
          penalty_type: string
          required_minutes: number
          required_sessions: number
          session_count: number
          state: string
          total_valid_minutes: number
          user_id: string
          valid_session_count: number
        }[]
      }
      challenge_results: {
        Args: { p_challenge_id: string }
        Returns: {
          completed_days: number
          completion_rate: number
          current_streak: number
          eligible_days: number
          future_days: number
          liability_sek: number
          longest_streak: number
          membership_active: boolean
          missed_days: number
          participation_end_date: string
          participation_start_date: string
          penalties_assigned: number
          penalties_earned: number
          penalties_received: number
          pending_days: number
          total_valid_minutes: number
          user_id: string
        }[]
      }
      challenge_streak_runs: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: {
          run_days: string[]
          run_len: number
          run_start: string
        }[]
      }
      challenge_valid_earned_penalties: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: {
          definition_id: string
          earned_on_date: string
          streak_run_start: string
        }[]
      }
      complete_challenge: {
        Args: { p_challenge_id: string }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      correct_challenge_start_date: {
        Args: {
          p_challenge_id: string
          p_new_start_date: string
          p_reason?: string
        }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      correct_start_weight: {
        Args: {
          p_challenge_id: string
          p_reason: string
          p_user_id: string
          p_weight_kg: number
        }
        Returns: undefined
      }
      create_challenge: {
        Args: {
          p_description?: string
          p_end_date: string
          p_missed_day_cost: number
          p_name: string
          p_proof_required?: boolean
          p_required_minutes: number
          p_start_date: string
          p_timezone?: string
        }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_role: { Args: never; Returns: string }
      disclose_weight_winner: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      duplicate_challenge: {
        Args: {
          p_copy_roster?: boolean
          p_end_date: string
          p_name: string
          p_source_id: string
          p_start_date: string
        }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_weight_competition: {
        Args: { p_challenge_id: string }
        Returns: {
          challenge_id: string
          determined_at: string
          determined_by: string | null
          disclosed_at: string | null
          disclosed_by: string | null
          winner_percentage_change: number | null
          winner_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "weight_competition_results"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_notification_preferences: {
        Args: { p_challenge_id: string }
        Returns: {
          chat_all_messages: boolean
          chat_like: boolean
          chat_reply: boolean
          challenge_id: string
          daily_group_summary: boolean
          game_master: boolean
          personal_status: boolean
          straffbanken: boolean
          training_reminders: boolean
          updated_at: string
          user_id: string
        }
      }
      hide_chat_message: {
        Args: { p_message_id: string; p_reason: string }
        Returns: undefined
      }
      invalidate_training_session: {
        Args: { p_entry_id: string; p_reason: string; p_reason_code?: string }
        Returns: {
          activity: string | null
          challenge_date: string
          challenge_id: string
          created_at: string
          duration_minutes: number
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidated_reason: string | null
          invalidated_reason_code: string | null
          note: string | null
          session_seq: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "training_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: never; Returns: boolean }
      is_challenge_member: {
        Args: { p_challenge_id: string }
        Returns: boolean
      }
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean }
      list_chat_messages: {
        Args: {
          p_before_seq?: number
          p_challenge_id: string
          p_limit?: number
        }
        Returns: {
          attachments: Json
          body: string
          challenge_id: string
          created_at: string
          id: string
          like_count: number
          liked_by_me: boolean
          reply_preview: Json
          sender_display_name: string
          sender_type: string
          sender_user_id: string
          seq: number
          status: string
          training_card: Json
        }[]
      }
      log_weight_entry: {
        Args: { p_challenge_id: string; p_weight_kg: number }
        Returns: {
          challenge_id: string
          created_at: string
          entry_date: string
          id: string
          updated_at: string
          user_id: string
          weight_kg: number
        }
        SetofOptions: {
          from: "*"
          to: "weight_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_chat_read: {
        Args: { p_challenge_id: string; p_seq: number }
        Returns: undefined
      }
      mark_game_master_event_seen: {
        Args: { p_dismiss?: boolean; p_event_id: string }
        Returns: undefined
      }
      post_chat_message: {
        Args: {
          p_attachments?: Json
          p_body?: string
          p_challenge_id: string
          p_message_id?: string
          p_reply_to_message_id?: string
        }
        Returns: {
          body: string | null
          challenge_id: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          reply_to_message_id: string | null
          sender_type: string
          sender_user_id: string | null
          seq: number
          status: string
          training_entry_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_challenge_start_date_correction: {
        Args: { p_challenge_id: string; p_new_start_date: string }
        Returns: Json
      }
      preview_penalty_target: {
        Args: { p_earned_penalty_id: string; p_to_user_id: string }
        Returns: Json
      }
      preview_retroactive_approval: {
        Args: { p_request_id: string }
        Returns: Json
      }
      reconcile_earned_penalties: {
        Args: { p_challenge_id: string; p_user_id?: string }
        Returns: undefined
      }
      register_push_subscription: {
        Args: {
          p_endpoint: string
          p_p256dh: string
          p_auth_key: string
          p_user_agent?: string
        }
        Returns: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          retired_at: string | null
          user_agent: string | null
          user_id: string
        }
      }
      reject_retroactive_registration: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      reopen_challenge: {
        Args: { p_challenge_id: string }
        Returns: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          missed_day_cost: number
          name: string
          proof_required: boolean
          required_minutes: number
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_game_master_pulse: {
        Args: { p_challenge_id: string }
        Returns: string
      }
      retroactive_requests_for_challenge: {
        Args: { p_challenge_id: string }
        Returns: {
          challenge_date: string
          id: string
          participant_reason: string
          review_note: string
          reviewed_at: string
          reviewed_by: string
          session_count: number
          status: string
          submitted_at: string
          user_id: string
        }[]
      }
      revalidate_training_session: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: {
          activity: string | null
          challenge_date: string
          challenge_id: string
          created_at: string
          duration_minutes: number
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidated_reason: string | null
          invalidated_reason_code: string | null
          note: string | null
          session_seq: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "training_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      seed_default_penalty_definitions: {
        Args: { p_challenge_id: string }
        Returns: {
          active: boolean
          challenge_id: string
          created_at: string
          display_name: string
          id: string
          penalty_type: string
          sort_order: number
          unlock_streak: number
          updated_at: string
          value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "challenge_penalty_definitions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_chat_message_like: {
        Args: { p_liked: boolean; p_message_id: string }
        Returns: Json
      }
      set_official_final_weight: {
        Args: {
          p_challenge_id: string
          p_reason: string
          p_user_id: string
          p_weight_kg: number
        }
        Returns: undefined
      }
      set_start_weight: {
        Args: { p_challenge_id: string; p_weight_kg: number }
        Returns: {
          challenge_id: string
          created_at: string
          is_weight_hidden: boolean
          official_final_recorded_at: string | null
          official_final_recorded_by: string | null
          official_final_weight_kg: number | null
          start_weight_first_saved_at: string | null
          start_weight_kg: number | null
          start_weight_locked_at: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "weight_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_weight_hidden: {
        Args: { p_challenge_id: string; p_hidden: boolean }
        Returns: undefined
      }
      shares_challenge_with: {
        Args: { p_other_user: string }
        Returns: boolean
      }
      submit_retroactive_registration: {
        Args: {
          p_challenge_date: string
          p_challenge_id: string
          p_reason: string
          p_sessions: Json
        }
        Returns: Json
      }
      try_cast_uuid: { Args: { p: string }; Returns: string }
      unread_chat_count: { Args: { p_challenge_id: string }; Returns: number }
      unregister_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      update_game_master_settings: {
        Args: {
          p_archive_enabled: boolean
          p_challenge_id: string
          p_enabled: boolean
          p_intensity: string
          p_private_roasts_enabled: boolean
          p_public_roasts_enabled: boolean
        }
        Returns: undefined
      }
      update_notification_preferences: {
        Args: {
          p_challenge_id: string
          p_chat_reply?: boolean
          p_chat_like?: boolean
          p_chat_all_messages?: boolean
          p_straffbanken?: boolean
          p_game_master?: boolean
          p_training_reminders?: boolean
          p_personal_status?: boolean
          p_daily_group_summary?: boolean
        }
        Returns: {
          chat_all_messages: boolean
          chat_like: boolean
          chat_reply: boolean
          challenge_id: string
          daily_group_summary: boolean
          game_master: boolean
          personal_status: boolean
          straffbanken: boolean
          training_reminders: boolean
          updated_at: string
          user_id: string
        }
      }
      weight_final_result: {
        Args: { p_challenge_id: string }
        Returns: {
          disclosed: boolean
          winner_display_name: string
          winner_percentage_change: number
          winner_user_id: string
        }[]
      }
      weight_public_ranking: {
        Args: { p_challenge_id: string }
        Returns: {
          display_name: string
          kg_change: number
          latest_entry_date: string
          latest_weight_kg: number
          percentage_change: number
          start_weight_kg: number
          user_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {},
  },
} as const
