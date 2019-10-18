// tslint:disable:array-type member-access no-console no-string-literal interface-over-type-literal
import {Injectable, OnDestroy} from '@angular/core';
import * as PouchdbAdapterIdb from 'pouchdb-adapter-idb';
import {RxCollection, RxDatabase, RxDocument} from 'rxdb';
import RxDB from 'rxdb/plugins/core';
import UpdatePlugin from 'rxdb/plugins/update';
import RxDBErrorMessagesModule from 'rxdb/plugins/error-messages';
import * as dumpPlugin from 'rxdb/plugins/json-dump';
import RxDBValidateModule from 'rxdb/plugins/validate';
import {Observable, of} from 'rxjs';
import {NgxRxdbCollectionConfig, NgxRxdbConfig, NgxRxdbDump} from './ngx-rxdb.interface';
import {NgxRxdbCollectionCreator} from './ngx-rxdb-collection.class';
import {promiseTimeout} from '../../util/promise-timeout';

RxDB.plugin(RxDBErrorMessagesModule);
RxDB.plugin(dumpPlugin);
RxDB.plugin(UpdatePlugin);
RxDB.plugin(RxDBValidateModule);
RxDB.plugin(PouchdbAdapterIdb);

const DEFAULT_ADAPTER = 'idb';
const DEFAULT_CONFIG = {
  name: 'default_name_please_change',
  adapter: DEFAULT_ADAPTER,
  multiInstance: true,
  queryChangeDetection: false,
  ignoreDuplicate: true,
};

@Injectable()
export class NgxRxdbService implements OnDestroy {
  private _dbInstance: RxDatabase;

  get db(): RxDatabase {
    return this._dbInstance;
  }

  set db(dbInstanceObj: RxDatabase) {
    this._dbInstance = dbInstanceObj;
  }

  get _imported() {
    return window.localStorage['_pouch_imported'];
  }

  set _imported(v) {
    window.localStorage['_pouch_imported'] = v;
  }

  constructor() {
    this._imported = window.localStorage['_pouch_imported'];
  }

  async ngOnDestroy() {
    // tslint:disable-next-line:no-unused-expression
    this._dbInstance && await this._dbInstance.destroy();
  }

  /**
   * This is run via APP_INITIALIZER in app.module.ts
   * to ensure the database exists before the angular-app starts up
   */
  async initDb(config: NgxRxdbConfig) {
    console.log('INIT DB');
    try {
      const db: RxDatabase = await RxDB.create<any>({
        ...DEFAULT_CONFIG,
        ...config
      });
      this._dbInstance = db;
      console.log(this.db);
      console.log('RxdbService: created database');
      // also can create collections from root config
      if (config && config.options && config.options.schemas) {
        await this.initCollections(config.options.schemas);
        console.log('RxdbService: created collections bulk');
      }
      console.log(config);

      if (config && config.options && config.options.dumpPath) {
        // fetch dump json
        const dump = await (await fetch(config.options.dumpPath)).json();
        // import only new dump
        if (!this._imported || this._imported !== dump['timestamp'].toString()) {
          await this.importDbDump(dump);
        }
      }
    } catch (error) {
      console.log(`RxdbService: error`, error);
    }
  }

  async initCollections(schemas: NgxRxdbCollectionConfig[]) {
    // wait for the array of results
    try {
      const collections: RxCollection[] = await Promise.all(
        schemas.map(schemaConfig => this.createCollection(schemaConfig))
      );
      console.log(`RxdbService: created ${collections.length} collections`);
      return collections;
    } catch (error) {
      console.log(`RxdbService: error`, error);
    }
  }

  /**
   * imports pouchdb dump to the database
   * must be used only after
   */
  async importDbDump(dumpObj: NgxRxdbDump) {
    try {
      const dump = this._prepareDump(dumpObj);
      await this.db.importDump(dump);
      this._imported = dump.timestamp;
    } catch (error) {
      if (error.status !== 409) {
        console.log(error);
      } else {
        // impoted but were conflicts with old docs - mark as imported
        this._imported = dumpObj.timestamp;
      }
    }
  }

  async createCollection(schemaConfig: NgxRxdbCollectionConfig) {
    console.log('CREATE COLLECTION');

    // TODO this needs to be fixed to be available initially
    await promiseTimeout(2500);

    if (!schemaConfig || !schemaConfig.schema) {
      throw new Error('RxdbService: missing schema object');
    }
    let collection: RxCollection = this.db[name];
    // delete collection if exists
    if (RxDB.isRxCollection(collection)) {
      console.log('RxdbService: collection', name, 'exists, skip create');
      await collection.remove();
    }
    collection = await this.db.collection(new NgxRxdbCollectionCreator(schemaConfig));
    console.log(`RxdbService: created collection "${name}"`);
    // preload data into collection
    const docsCount = await collection.countAllDocuments();
    console.log(`RxdbService: collection "${name}" has "${parseInt(docsCount, 0)}" docs`);
    if (schemaConfig.options && schemaConfig.options.initialDocs && !!!docsCount) {
      const dumpObj = {
        name,
        schemaHash: collection.schema.hash,
        encrypted: false,
        docs: [...schemaConfig.options.initialDocs],
      };
      await collection.importDump(dumpObj);
      console.log(`RxdbService: imported ${schemaConfig.options.initialDocs.length} docs for collection "${name}"`);
    }
    return collection;
  }

  getCollection(name: string): RxCollection {
    const collection: RxCollection = this.db[name];
    if (RxDB.isRxCollection(collection)) {
      return collection;
    } else {
      console.warn(`RxdbService: returned false for RxDB.isRxCollection(${name})`);
      return null;
    }
  }

  getAllDocs(name: string): Observable<RxDocument<any>[]> {
    const collection: RxCollection = this.db[name];
    return RxDB.isRxCollection(collection) ? collection.find().$ : of([]);
  }

  /**
   * change schemaHashes from dump to existing schema hashes
   */
  private _prepareDump(dumpObj: NgxRxdbDump): NgxRxdbDump {
    const dumpWithHashes = {...dumpObj};
    const collections = this.db.collections as any;
    if (!collections) {
      throw new Error('collections must be initialized before importing dump');
    }
    for (const key of collections) {
      if (dumpWithHashes.collections.hasOwnProperty(key)) {
        dumpWithHashes.collections[key].schemaHash = collections[key].schema['_hash'];
      }
    }
    return dumpWithHashes;
  }
}