'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { registerRoleLabels } from '@/lib/permissions';

/** Lightweight {key,label} list of all roles — for user role dropdowns. */
export function useRoleOptions() {
  return useQuery({
    queryKey: ['role-options'],
    queryFn: () => api.get('/roles/options'),
    staleTime: 5 * 60 * 1000,
    select: (res) => {
      const roles = res.roles ?? [];
      // Keep the app-wide label cache current so bare-key `prettyRole` calls
      // (activity feed, report role counts) show edited names too.
      registerRoleLabels(roles);
      return roles;
    },
  });
}

/** Full role list with permissions + user counts (for the Roles admin page). */
export function useRoles(enabled = true) {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles'),
    enabled,
    select: (res) => res.roles ?? [],
  });
}

/** The grouped permission catalog (for the editor). */
export function usePermissionCatalog(enabled = true) {
  return useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => api.get('/roles/catalog'),
    enabled,
    staleTime: 30 * 60 * 1000,
  });
}
