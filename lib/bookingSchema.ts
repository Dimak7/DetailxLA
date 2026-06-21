import { z } from "zod";
import { vehicleTypes as pricedVehicleTypes } from "./pricing";
import { timeSlots } from "./schedule";

export const bookingServices = [
  "Exterior Detail",
  "Interior Full Detail",
  "Full Detail",
  "Deep Detail",
  "Maintenance Detail",
  "Monthly Maintenance Service",
  "Headlight Restoration",
  "Ceramic Coating",
  "Window Tint",
  "Paint Correction",
  "Boat Detailing",
] as const;

export const vehicleTypes = pricedVehicleTypes;

const bookingDetailSchema = z.object({
  service: z.enum(bookingServices),
  vehicleType: z.enum(vehicleTypes),
  notes: z.string().trim().max(500).optional().default(""),
});

export const bookingSchema = z.object({
  service: z.enum(bookingServices),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date."),
  time: z.enum(timeSlots),
  name: z.string().trim().min(2, "Name is required.").max(120),
  phone: z.string().trim().min(7, "Phone number is required.").max(30),
  email: z.union([z.email("Enter a valid email address.").max(180), z.literal("")]).optional().default(""),
  carModel: z.string().trim().max(120).optional().default(""),
  vehicleType: z.enum(vehicleTypes),
  address: z.string().trim().min(5, "Service location is required.").max(240),
  estimatedPrice: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(800).optional().default(""),
  durationHours: z.number().int().min(2).max(12).optional().default(2),
  details: z.array(bookingDetailSchema).min(1).max(6).optional(),
  source: z.enum(["website", "telegram_manual", "admin_manual"]).optional().default("website"),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export function assertFutureDate(dateValue: string) {
  const selected = new Date(`${dateValue}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (Number.isNaN(selected.getTime()) || selected < today) {
    throw new Error("Choose a future booking date.");
  }
}
