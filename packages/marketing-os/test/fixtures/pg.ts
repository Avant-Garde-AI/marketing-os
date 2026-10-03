/** Unit tests must never connect to a real database. Individual suites supply their fake Pool. */
export class Pool {
  query(): never { throw new Error("Mock the database seam for this unit test"); }
  connect(): never { throw new Error("Mock the database seam for this unit test"); }
}
