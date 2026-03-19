export interface DeliveryRouteParams {
  goodsDelivery: boolean;
  vehicleHeight?: number; // meters
  vehicleWeight?: number; // kg
  vehicleType?: "car" | "van" | "truck";
}

export const defaultDeliveryParams: DeliveryRouteParams = {
  goodsDelivery: false,
  vehicleHeight: undefined,
  vehicleWeight: undefined,
  vehicleType: "car",
};

/** When goods delivery is enabled. */
export const deliveryModeParams: DeliveryRouteParams = {
  goodsDelivery: true,
  vehicleHeight: 3.5, // Default truck height (meters)
  vehicleWeight: 3500, // Default truck weight (kg)
  vehicleType: "truck",
};
