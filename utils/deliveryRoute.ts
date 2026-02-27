import type { DeliveryRouteParams } from "@/types/routeParams";
import { defaultDeliveryParams, deliveryModeParams } from "@/types/routeParams";

export const toggleDeliveryMode = (
  currentParams: DeliveryRouteParams
): DeliveryRouteParams => {
  return currentParams.goodsDelivery
    ? defaultDeliveryParams // Turn OFF
    : deliveryModeParams; // Turn ON
};
