import { z } from "zod";
import { Id, itemTypes } from "./items.ts";

export const chartMeasures = ["payload", "accuracy", "attempts", "minutes"] as const;

export const chartAggregates = ["mean", "median", "total"] as const;

export type ChartAggregate = (typeof chartAggregates)[number];

export const MAX_CHART_DAYS = 3650;

const Name = z.string().min(1);

const ItemFilter = z.union(
  [z.strictObject({ tag: Name }), z.strictObject({ type: z.enum(itemTypes) }), z.strictObject({ drill: Name })],
  { error: "Filter items by one of tag, type or drill" },
);

const common = {
  id: Id,
  title: z.string().min(1),
  kind: z.enum(["line", "bar"]),
  days: z.int().min(1).max(MAX_CHART_DAYS),
};

const Aggregate = (fallback: ChartAggregate) => z.enum(chartAggregates).default(fallback);

export const Chart = z.discriminatedUnion(
  "measure",
  [
    z.strictObject({ ...common, measure: z.literal("payload"), field: Name, aggregate: Aggregate("median"), items: ItemFilter.optional() }),
    z.strictObject({ ...common, measure: z.literal("accuracy"), items: ItemFilter.optional() }),
    z.strictObject({ ...common, measure: z.literal("attempts"), aggregate: Aggregate("total"), items: ItemFilter.optional() }),
    z.strictObject({ ...common, measure: z.literal("minutes"), aggregate: Aggregate("total"), items: ItemFilter.optional() }),
  ],
  {
    error: (issue) =>
      issue.code === "invalid_union" ? `Unknown measure; use one of ${chartMeasures.join(", ")}` : undefined,
  },
);

export type Chart = z.output<typeof Chart>;
