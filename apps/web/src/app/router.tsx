import { createBrowserRouter } from 'react-router';
import { RequireCustomer, RequireStaff, RedirectIfSignedIn, RequirePermission } from './guards';
import { PortalShell } from './PortalShell';
import { StaffShell } from './StaffShell';
import { RouteError } from './RouteError';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { UsersPage } from '../features/users/UsersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { NotFoundPage } from './NotFoundPage';
import { CustomersPage } from '../features/customers/CustomersPage';
import { CustomerDetailPage } from '../features/customers/CustomerDetailPage';
import { AssetsPage } from '../features/assets/AssetsPage';
import { AssetDetailPage } from '../features/assets/AssetDetailPage';
import { ActivityPage } from '../features/activity/ActivityPage';
import { PortalDevicesPage } from '../features/portal/PortalDevicesPage';
import { PortalDevicePage } from '../features/portal/PortalDevicePage';
import { PortalRepairsPage } from '../features/portal/PortalRepairsPage';
import { PortalRepairPage } from '../features/portal/PortalRepairPage';
import { RepairsPage } from '../features/repairs/RepairsPage';
import { RepairDetailPage } from '../features/repairs/RepairDetailPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { MovementsPage } from '../features/inventory/MovementsPage';
import { PartDetailPage } from '../features/inventory/PartDetailPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import type { Permission } from '@deviceflow/shared';
import type { ReactNode } from 'react';

const guarded = (permission: Permission, element: ReactNode) => (
  <RequirePermission permission={permission}>{element}</RequirePermission>
);

/**
 * Route guards improve the experience (no flashes of forbidden screens), but
 * they are not security: every API endpoint enforces permissions itself.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        path: '/login',
        element: (
          <RedirectIfSignedIn>
            <LoginPage />
          </RedirectIfSignedIn>
        ),
      },
      {
        path: '/',
        element: (
          <RequireStaff>
            <StaffShell />
          </RequireStaff>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'repairs', element: guarded('repairs:read', <RepairsPage />) },
          { path: 'repairs/:id', element: guarded('repairs:read', <RepairDetailPage />) },
          { path: 'assets', element: guarded('assets:read', <AssetsPage />) },
          { path: 'assets/:id', element: guarded('assets:read', <AssetDetailPage />) },
          { path: 'inventory', element: guarded('inventory:read', <InventoryPage />) },
          { path: 'inventory/movements', element: guarded('inventory:read', <MovementsPage />) },
          {
            path: 'inventory/parts/:id',
            element: guarded('inventory:read', <PartDetailPage />),
          },
          // Everyone with reports:operations also has reports:inventory, so this
          // admits both roles that see reports; the page shows each its sections.
          { path: 'reports', element: guarded('reports:inventory', <ReportsPage />) },
          { path: 'customers', element: guarded('customers:read', <CustomersPage />) },
          { path: 'customers/:id', element: guarded('customers:read', <CustomerDetailPage />) },
          { path: 'admin/activity', element: guarded('audit:read', <ActivityPage />) },
          {
            path: 'admin/users',
            element: (
              <RequirePermission permission="users:read">
                <UsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'admin/settings',
            element: (
              <RequirePermission permission="settings:read">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        path: '/portal',
        element: (
          <RequireCustomer>
            <PortalShell />
          </RequireCustomer>
        ),
        children: [
          { index: true, element: <PortalDevicesPage /> },
          { path: 'devices/:id', element: <PortalDevicePage /> },
          { path: 'repairs', element: <PortalRepairsPage /> },
          { path: 'repairs/:id', element: <PortalRepairPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
