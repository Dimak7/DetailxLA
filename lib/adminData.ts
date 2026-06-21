import type { BookingDetailEstimate } from "./pricing";
import { buildBookingEstimate } from "./pricing";
import type { StoredBooking } from "./bookingStore";

export type AdminClient = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  vehicles: string[];
  bookings: StoredBooking[];
  totalSpent: number;
  lastServiceDate: string;
  tags: string[];
};

export function getBookingDetails(booking: StoredBooking): BookingDetailEstimate[] {
  if (booking.details?.length && booking.details.every((detail) => "estimatedPrice" in detail && "lineNumber" in detail)) {
    return booking.details as unknown as BookingDetailEstimate[];
  }

  const details = [{
    service: booking.service || "Service not provided",
    vehicleType: booking.vehicleType || "Vehicle not provided",
    notes: booking.notes || "",
  }];

  return buildBookingEstimate(details).details;
}

export function getBookingAmount(booking: StoredBooking) {
  const amount = Number((booking.estimatedPrice || "").replace(/,/g, "").match(/\d+/)?.[0] || 0);
  if (amount) {
    return amount;
  }

  return buildBookingEstimate(getBookingDetails(booking)).totalAmount;
}

export function buildAdminClients(bookings: StoredBooking[]): AdminClient[] {
  const clients = new Map<string, AdminClient>();

  bookings.forEach((booking) => {
    const key = (booking.email || booking.phone || booking.name || booking.id).trim().toLowerCase();
    const existing = clients.get(key);
    const vehicleTypes = getBookingDetails(booking).map((detail) => detail.vehicleType || "Vehicle not provided");

    if (existing) {
      existing.bookings.push(booking);
      existing.totalSpent += booking.status === "cancelled" ? 0 : getBookingAmount(booking);
      existing.lastServiceDate = [existing.lastServiceDate, booking.date].sort().at(-1) || booking.date;
      vehicleTypes.forEach((vehicle) => {
        if (!existing.vehicles.includes(vehicle)) {
          existing.vehicles.push(vehicle);
        }
      });
      existing.tags = getClientTags(existing);
      return;
    }

    const client: AdminClient = {
      id: key,
      name: booking.name || "Not provided",
      email: booking.email || "",
      phone: booking.phone || "",
      address: booking.address || "",
      vehicles: [...new Set(vehicleTypes)],
      bookings: [booking],
      totalSpent: booking.status === "cancelled" ? 0 : getBookingAmount(booking),
      lastServiceDate: booking.date,
      tags: [],
    };
    client.tags = getClientTags(client);
    clients.set(key, client);
  });

  return Array.from(clients.values()).sort((a, b) => b.lastServiceDate.localeCompare(a.lastServiceDate));
}

export function getDashboardMetrics(bookings: StoredBooking[]) {
  const today = getDateString(new Date());
  const weekAgo = getDateString(addDays(new Date(), -7));
  const monthStart = getDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const activeBookings = bookings.filter((booking) => booking.status !== "cancelled");
  const clients = buildAdminClients(bookings);
  const monthBookings = activeBookings.filter((booking) => booking.date >= monthStart);
  const monthRevenue = monthBookings.reduce((total, booking) => total + getBookingAmount(booking), 0);

  return {
    todayBookings: activeBookings.filter((booking) => booking.date === today),
    upcomingBookings: activeBookings.filter((booking) => booking.date >= today).slice(0, 8),
    pendingCount: bookings.filter((booking) => booking.status === "pending").length,
    completedCount: bookings.filter((booking) => booking.status === "completed").length,
    cancelledCount: bookings.filter((booking) => booking.status === "cancelled").length,
    bookingsThisWeek: activeBookings.filter((booking) => booking.date >= weekAgo).length,
    revenueThisMonth: monthRevenue,
    repeatCustomers: clients.filter((client) => client.bookings.length > 1).length,
    averageTicket: monthBookings.length ? Math.round(monthRevenue / monthBookings.length) : 0,
    recentClients: clients.slice(0, 6),
  };
}

export function getDashboardAnalytics(bookings: StoredBooking[], input: { days: number; marketingExpense: number }) {
  const todayDate = new Date();
  const startDate = addDays(todayDate, -(input.days - 1));
  const today = getDateString(todayDate);
  const start = getDateString(startDate);
  const activeBookings = bookings.filter((booking) => booking.status !== "cancelled");
  const rangeBookings = activeBookings.filter((booking) => booking.date >= start && booking.date <= today);
  const revenue = rangeBookings.reduce((total, booking) => total + getBookingAmount(booking), 0);
  const clients = buildAdminClients(rangeBookings);
  const series = Array.from({ length: input.days }, (_, index) => {
    const date = getDateString(addDays(startDate, index));
    const dayBookings = rangeBookings.filter((booking) => booking.date === date);

    return {
      date,
      revenue: dayBookings.reduce((total, booking) => total + getBookingAmount(booking), 0),
      bookings: dayBookings.length,
    };
  });

  return {
    rangeStart: start,
    rangeEnd: today,
    revenue,
    totalClients: clients.length,
    marketingExpense: input.marketingExpense,
    profit: revenue - input.marketingExpense,
    series,
  };
}

export function formatMoney(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

export function getDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getClientTags(client: AdminClient) {
  const tags = new Set<string>();
  if (client.bookings.length > 1) {
    tags.add("Repeat customer");
  }
  if (client.bookings.some((booking) => /tint/i.test(booking.service))) {
    tags.add("Tint lead");
  }
  if (client.bookings.some((booking) => /ceramic/i.test(booking.service))) {
    tags.add("Ceramic lead");
  }
  if (client.lastServiceDate < getDateString(addDays(new Date(), -60))) {
    tags.add("No booking in 60 days");
  }

  return Array.from(tags);
}
