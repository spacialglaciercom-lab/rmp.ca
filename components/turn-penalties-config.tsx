import * as Haptics from "expo-haptics";

import { TurnPenaltyConfig } from "@/components/TurnPenaltyConfig";
import { useRouting, generateLogEntry } from "@/lib/routing-context";
import type { TurnPenalties } from "@/types/routing";

export function TurnPenaltiesConfig() {
  const { state, dispatch } = useRouting();
  const initialConfig = state.configuration.turnPenalties;

  const handleApply = (penalties: TurnPenalties) => {
    dispatch({ type: "SET_TURN_PENALTIES", payload: penalties });
    dispatch({
      type: "ADD_LOG_ENTRY",
      payload: generateLogEntry(
        `Turn penalties updated: Left=${penalties.leftTurn}, U-Turn=${penalties.uTurn}, Right=${penalties.rightTurn}`,
        "success"
      ),
    });
  };

  return (
    <TurnPenaltyConfig
      initialConfig={initialConfig}
      onApply={handleApply}
    />
  );
}
