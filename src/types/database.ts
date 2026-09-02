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
            isOneToOne: true
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _next_penalty_target_date: {
        Args: { p_challenge_id: string; p_to_user_id: string }
        Returns: string
      }
      _reconcile_earned_penalties: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: undefined
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
      cancel_penalty_assignment: {
        Args: { p_assignment_id: string; p_reason: string }
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
      preview_penalty_target: {
        Args: { p_earned_penalty_id: string; p_to_user_id: string }
        Returns: Json
      }
      reconcile_earned_penalties: {
        Args: { p_challenge_id: string; p_user_id?: string }
        Returns: undefined
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
      shares_challenge_with: {
        Args: { p_other_user: string }
        Returns: boolean
      }
      try_cast_uuid: { Args: { p: string }; Returns: string }
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
