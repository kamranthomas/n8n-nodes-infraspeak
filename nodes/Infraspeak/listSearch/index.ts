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

	/** The API has no search param for these three, so the factory filters by label. */
	getSuppliers: makeListSearch({
		endpoint: '/suppliers',
		label: (a) => withCode(a.name, a.code),
	}),

	getOperators: makeListSearch({
		endpoint: '/operators',
		label: (a) => String(a.full_name),
	}),

	getCostCenters: makeListSearch({
		endpoint: '/cost-centers',
		label: (a) => withCode(a.name, a.code),
	}),

	/** All levels, not just the top-level folders that /categories returns. */
	getCategories: makeListSearch({
		endpoint: '/categories/all',
		searchParam: 'sc_search',
		label: (a) => withCode(a.name, a.full_code ?? a.code),
	}),

	getWarehouses: makeListSearch({
		endpoint: '/stocks/warehouses',
		searchParam: 'searchText',
		label: (a) => withCode(a.name, a.code),
	}),
};
