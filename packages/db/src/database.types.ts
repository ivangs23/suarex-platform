export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      allergens: {
        Row: {
          icon: string | null
          id: number
          name_i18n: Json
          tenant_id: string | null
        }
        Insert: {
          icon?: string | null
          id?: number
          name_i18n: Json
          tenant_id?: string | null
        }
        Update: {
          icon?: string | null
          id?: number
          name_i18n?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allergens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          destination: string
          icon: string | null
          id: string
          image_url: string | null
          name_i18n: Json
          parent_id: string | null
          slug: string
          sort_order: number
          tax_rate: number | null
          tenant_id: string
          visible_desde: string | null
          visible_hasta: string | null
        }
        Insert: {
          created_at?: string
          destination?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name_i18n: Json
          parent_id?: string | null
          slug: string
          sort_order?: number
          tax_rate?: number | null
          tenant_id: string
          visible_desde?: string | null
          visible_hasta?: string | null
        }
        Update: {
          created_at?: string
          destination?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name_i18n?: Json
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tax_rate?: number | null
          tenant_id?: string
          visible_desde?: string | null
          visible_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string | null
          auth_user_id: string | null
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          offline_alerted_at: string | null
          os: string | null
          paired_at: string | null
          pairing_code: string | null
          pairing_expires_at: string | null
          payment_terminal_id: string | null
          printers: string[]
          roles: string[]
          tenant_id: string
          totem_token: string
          venue_id: string
        }
        Insert: {
          app_version?: string | null
          auth_user_id?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          offline_alerted_at?: string | null
          os?: string | null
          paired_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          payment_terminal_id?: string | null
          printers?: string[]
          roles?: string[]
          tenant_id: string
          totem_token?: string
          venue_id: string
        }
        Update: {
          app_version?: string | null
          auth_user_id?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          offline_alerted_at?: string | null
          os?: string | null
          paired_at?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          payment_terminal_id?: string | null
          printers?: string[]
          roles?: string[]
          tenant_id?: string
          totem_token?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_scans: {
        Row: {
          dia: string
          escaneos: number
          tenant_id: string
          venue_id: string
        }
        Insert: {
          dia: string
          escaneos?: number
          tenant_id: string
          venue_id: string
        }
        Update: {
          dia?: string
          escaneos?: number
          tenant_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_scans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_scans_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          date: string
          last_number: number
          tenant_id: string
          venue_id: string
        }
        Insert: {
          date: string
          last_number?: number
          tenant_id: string
          venue_id: string
        }
        Update: {
          date?: string
          last_number?: number
          tenant_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_counters_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_extras: {
        Row: {
          extra_id: string | null
          id: string
          name_snapshot: Json
          order_item_id: string
          price: number
          tenant_id: string
        }
        Insert: {
          extra_id?: string | null
          id?: string
          name_snapshot: Json
          order_item_id: string
          price: number
          tenant_id: string
        }
        Update: {
          extra_id?: string | null
          id?: string
          name_snapshot?: Json
          order_item_id?: string
          price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_extras_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "product_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_extras_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_extras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          destination: string
          id: string
          line_total: number
          name_snapshot: Json
          notes: string | null
          order_id: string
          product_id: string | null
          quantity: number
          tax_rate: number
          tenant_id: string
          unit_price: number
        }
        Insert: {
          destination: string
          id?: string
          line_total: number
          name_snapshot: Json
          notes?: string | null
          order_id: string
          product_id?: string | null
          quantity: number
          tax_rate?: number
          tenant_id: string
          unit_price: number
        }
        Update: {
          destination?: string
          id?: string
          line_total?: number
          name_snapshot?: Json
          notes?: string | null
          order_id?: string
          product_id?: string | null
          quantity?: number
          tax_rate?: number
          tenant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bar_status: string
          channel: string
          created_at: string
          currency: string
          disputed_at: string | null
          id: string
          kitchen_status: string
          order_number: number
          paid_at: string | null
          printed_at: string | null
          printed_targets: Json
          public_token: string
          refunded_at: string | null
          refunded_cents: number | null
          status: string
          stripe_payment_intent_id: string | null
          subtotal: number
          table_id: string | null
          table_label: string | null
          tax_amount: number
          tenant_id: string
          total: number
          venue_id: string
        }
        Insert: {
          bar_status?: string
          channel?: string
          created_at?: string
          currency?: string
          disputed_at?: string | null
          id?: string
          kitchen_status?: string
          order_number: number
          paid_at?: string | null
          printed_at?: string | null
          printed_targets?: Json
          public_token?: string
          refunded_at?: string | null
          refunded_cents?: number | null
          status?: string
          stripe_payment_intent_id?: string | null
          subtotal?: number
          table_id?: string | null
          table_label?: string | null
          tax_amount?: number
          tenant_id: string
          total?: number
          venue_id: string
        }
        Update: {
          bar_status?: string
          channel?: string
          created_at?: string
          currency?: string
          disputed_at?: string | null
          id?: string
          kitchen_status?: string
          order_number?: number
          paid_at?: string | null
          printed_at?: string | null
          printed_targets?: Json
          public_token?: string
          refunded_at?: string | null
          refunded_cents?: number | null
          status?: string
          stripe_payment_intent_id?: string | null
          subtotal?: number
          table_id?: string | null
          table_label?: string | null
          tax_amount?: number
          tenant_id?: string
          total?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      pair_attempts: {
        Row: {
          count: number
          ip: string
          window_start: string
        }
        Insert: {
          count?: number
          ip: string
          window_start?: string
        }
        Update: {
          count?: number
          ip?: string
          window_start?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          user_id?: string
        }
        Relationships: []
      }
      printers: {
        Row: {
          connection: Json
          created_at: string
          destination: string
          device_id: string | null
          enabled: boolean
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          venue_id: string
        }
        Insert: {
          connection: Json
          created_at?: string
          destination?: string
          device_id?: string | null
          enabled?: boolean
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          venue_id: string
        }
        Update: {
          connection?: Json
          created_at?: string
          destination?: string
          device_id?: string | null
          enabled?: boolean
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "printers_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      product_extras: {
        Row: {
          group_id: string | null
          id: string
          name_i18n: Json
          price: number
          product_id: string
          tenant_id: string
        }
        Insert: {
          group_id?: string | null
          id?: string
          name_i18n: Json
          price: number
          product_id: string
          tenant_id: string
        }
        Update: {
          group_id?: string | null
          id?: string
          name_i18n?: Json
          price?: number
          product_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_extras_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_option_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_extras_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_extras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_option_groups: {
        Row: {
          id: string
          max_select: number
          min_select: number
          name_i18n: Json
          product_id: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          id?: string
          max_select?: number
          min_select?: number
          name_i18n: Json
          product_id: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          id?: string
          max_select?: number
          min_select?: number
          name_i18n?: Json
          product_id?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_option_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allergen_ids: number[]
          category_id: string
          created_at: string
          description_i18n: Json
          id: string
          image_url: string | null
          is_available: boolean
          name_i18n: Json
          price: number
          sort_order: number
          tax_rate: number | null
          tenant_id: string
          unavailable_until: string | null
        }
        Insert: {
          allergen_ids?: number[]
          category_id: string
          created_at?: string
          description_i18n?: Json
          id?: string
          image_url?: string | null
          is_available?: boolean
          name_i18n: Json
          price: number
          sort_order?: number
          tax_rate?: number | null
          tenant_id: string
          unavailable_until?: string | null
        }
        Update: {
          allergen_ids?: number[]
          category_id?: string
          created_at?: string
          description_i18n?: Json
          id?: string
          image_url?: string | null
          is_available?: boolean
          name_i18n?: Json
          price?: number
          sort_order?: number
          tax_rate?: number | null
          tenant_id?: string
          unavailable_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hits: {
        Row: {
          bucket: string
          count: number
          key: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          bucket?: string
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          received_at: string
          tenant_id: string | null
          type: string
        }
        Insert: {
          id: string
          received_at?: string
          tenant_id?: string | null
          type: string
        }
        Update: {
          id?: string
          received_at?: string
          tenant_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          tenant_id: string
          token: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          tenant_id: string
          token?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          tenant_id?: string
          token?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_payment_config: {
        Row: {
          access_key: string | null
          company_id: string | null
          config: Json
          mock: boolean
          provider: string
          secret_key: string | null
          secrets: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_key?: string | null
          company_id?: string | null
          config?: Json
          mock?: boolean
          provider?: string
          secret_key?: string | null
          secrets?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_key?: string | null
          company_id?: string | null
          config?: Json
          mock?: boolean
          provider?: string
          secret_key?: string | null
          secrets?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_payment_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          branding: Json
          channels: string[]
          currency: string
          features: Json
          fiscal: Json
          locale: string
          tenant_id: string
          theme: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          channels?: string[]
          currency?: string
          features?: Json
          fiscal?: Json
          locale?: string
          tenant_id: string
          theme?: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          channels?: string[]
          currency?: string
          features?: Json
          fiscal?: Json
          locale?: string
          tenant_id?: string
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_stripe_config: {
        Row: {
          publishable_key: string | null
          secrets: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          publishable_key?: string | null
          secrets?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          publishable_key?: string | null
          secrets?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_stripe_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          custom_domain: string | null
          grace_until: string | null
          id: string
          name: string
          plan: string
          plan_status: string
          slug: string
          status: string
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
        }
        Insert: {
          created_at?: string
          custom_domain?: string | null
          grace_until?: string | null
          id?: string
          name: string
          plan?: string
          plan_status?: string
          slug: string
          status?: string
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
        }
        Update: {
          created_at?: string
          custom_domain?: string | null
          grace_until?: string | null
          id?: string
          name?: string
          plan?: string
          plan_status?: string
          slug?: string
          status?: string
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      venues: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          slug: string
          tenant_id: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          slug: string
          tenant_id: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          slug?: string
          tenant_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pg_anon_grants_check: {
        Row: {
          privilege_type: string | null
          tablename: unknown
        }
        Relationships: []
      }
      pg_policies_tenant_check: {
        Row: {
          cmd: string | null
          policyname: unknown
          qual: string | null
          schemaname: unknown
          tablename: unknown
          with_check: string | null
        }
        Relationships: []
      }
      pg_tables_rls_check: {
        Row: {
          rowsecurity: boolean | null
          tablename: unknown
        }
        Relationships: []
      }
    }
    Functions: {
      check_pair_rate_limit: {
        Args: { p_ip: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_key: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_role: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      device_heartbeat: {
        Args: { p_app_version: string; p_printers?: string[] }
        Returns: undefined
      }
      device_zonas_horarias: {
        Args: never
        Returns: {
          timezone: string
          venue_id: string
        }[]
      }
      expire_pending_orders: {
        Args: { p_timeout_minutes?: number }
        Returns: string[]
      }
      get_payment_config_self: {
        Args: never
        Returns: {
          access_key: string
          company_id: string
          mock: boolean
          pinpad_id: string
          provider: string
          secret_key: string
        }[]
      }
      get_payment_config_self_v2: {
        Args: never
        Returns: {
          config: Json
          mock: boolean
          provider: string
          secrets: Json
          terminal_id: string
        }[]
      }
      list_tenant_scoped_tables: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      marcar_agotado_hoy: {
        Args: { p_product_id: string; p_tenant_id: string }
        Returns: string
      }
      mark_kiosko_order_paid: { Args: { p_order_id: string }; Returns: boolean }
      next_order_number: {
        Args: { p_tenant_id: string; p_venue_id: string }
        Returns: number
      }
      purge_order_personal_data: {
        Args: { p_notes_days?: number; p_orders_months?: number }
        Returns: {
          notas_borradas: number
          pedidos_borrados: number
        }[]
      }
      record_order_refund: {
        Args: { p_payment_intent_id: string; p_refunded_cents: number }
        Returns: string
      }
      registrar_escaneo: { Args: { p_table_id: string }; Returns: undefined }
      reserve_printed: {
        Args: {
          p_at: string
          p_order_id: string
          p_printer_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      reserve_printed_self: {
        Args: { p_at: string; p_order_id: string; p_printer_id: string }
        Returns: undefined
      }
      sweep_device_health: {
        Args: { p_minutos?: number }
        Returns: {
          device_id: string
          nombre: string
          tenant_slug: string
          transicion: string
          ultimo_latido: string
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
  public: {
    Enums: {},
  },
} as const

