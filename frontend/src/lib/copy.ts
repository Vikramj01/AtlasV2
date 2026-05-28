export function clientLabel(orgType: 'agency' | 'brand' | null | undefined): string {
  return orgType === 'brand' ? 'My Tracking' : 'Clients';
}

export function siteLabel(orgType: 'agency' | 'brand' | null | undefined): string {
  return orgType === 'brand' ? 'My Website' : 'Client Website';
}

export function clientsRouteLabel(orgType: 'agency' | 'brand' | null | undefined): string {
  return orgType === 'brand' ? 'My Tracking' : 'Clients';
}
