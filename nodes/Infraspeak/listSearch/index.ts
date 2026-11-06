import { findLocatorValue, makeListSearch } from './factory';

const withCode = (name: unknown, code: unknown) =>
	code ? `${String(name)} (${String(code)})` : String(name);

export const listSearch = {
	getClients: makeListSearch({
		endpoint: '/clients',
		searchParam: 's_name_like',
		qs: { sort: 'name' },
		label: (a) => withCode(a.name, a.code),
	}),

	/** Only real locations: failures and assets can't be attached to buildings or folders. */
	getLocations: makeListSearch({
		endpoint: '/locations',
		searchParam: 'sc_search',
		qs: { is_real: true },
		type: 'location',
		label: (a) => (a.full_code ? `${String(a.full_code)} – ${String(a.name)}` : String(a.name)),
	}),

	getProblemAreas: makeListSearch({
		endpoint: '/problems',
		label: (a) => String(a.full_name ?? a.name),
	}),

	/** Problem types are only listable per area, so this depends on the Problem Area field. */
	getProblemTypes: makeListSearch({
		endpoint() {
			const areaId = findLocatorValue.call(this, 'problemAreaId');
			return areaId ? `/problems/${encodeURIComponent(areaId)}/subproblems` : undefined;
		},
		label: (a) => String(a.full_name ?? a.name),
	}),
};
