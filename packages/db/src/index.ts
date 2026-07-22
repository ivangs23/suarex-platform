export { getCategories, getProducts } from "./catalog.js";
export type { PairDeviceResult } from "./devices.js";
export { pairDevice } from "./devices.js";
export type { TableMenu } from "./menu.js";
export { loadTableMenu } from "./menu.js";
export type { MarkPaidOutcome } from "./orders.js";
export {
  attachPaymentIntent,
  cancelOrphanedPendingOrder,
  createPendingOrder,
  getOrderByPublicToken,
  markOrderPaid,
  OrderCartError,
} from "./orders.js";
export type { StaffOrder, StaffOrderItem, StationStatus } from "./staff-orders.js";
export { listActiveOrders, markStationDone } from "./staff-orders.js";
export { findTableByToken } from "./tables.js";
export { findTenantByHost, getTenantSettings, getTenantStripeAccount } from "./tenants.js";
export type {
  CartLineInput,
  Category,
  OrderStatus,
  Product,
  ProductExtra,
  TableRow,
  Tenant,
  TenantSettingsRow,
} from "./types.js";
