/**
 * this plugin adds the json export/import capabilities to RxDB
 */
import {
    hash
} from '../util';
import {
    createRxQuery
} from '../rx-query';
import {
    newRxError
} from '../rx-error';
import {
    createChangeEvent
} from '../rx-change-event';
import {
    RxDatabase
} from '../types';

function dumpRxDatabase(
    this: RxDatabase,
    decrypted = false,
    collections: any = null
): Promise<any> {
    const json: any = {
        name: this.name,
        instanceToken: this.token,
        encrypted: false,
        passwordHash: null,
        collections: []
    };

    if (this.password) {
        json.passwordHash = hash(this.password);
        if (decrypted) json.encrypted = false;
        else json.encrypted = true;
    }

    const useCollections = Object.keys(this.collections)
        .filter(colName => !collections || collections.includes(colName))
        .filter(colName => colName.charAt(0) !== '_')
        .map(colName => this.collections[colName]);

    return Promise.all(
        useCollections
            .map(col => col.dump(decrypted))
    ).then(cols => {
        json.collections = cols;
        return json;
    });
}

const importDumpRxDatabase = function (
    this: RxDatabase,
    dump: any
) {
    /**
     * collections must be created before the import
     * because we do not know about the other collection-settings here
     */
    const missingCollections = dump.collections
        .filter((col: any) => !this.collections[col.name])
        .map((col: any) => col.name);
    if (missingCollections.length > 0) {
        throw newRxError('JD1', {
            missingCollections
        });
    }

    return Promise.all(
        dump.collections
            .map((colDump: any) => this.collections[colDump.name].importDump(colDump))
    );
};

const dumpRxCollection = function (
    this: any,
    decrypted = false
) {
    const encrypted = !decrypted;

    const json: any = {
        name: this.name,
        schemaHash: this.schema.hash,
        encrypted: false,
        passwordHash: null,
        docs: []
    };

    if (this.database.password && encrypted) {
        json.passwordHash = hash(this.database.password);
        json.encrypted = true;
    }

    const query = createRxQuery('find', {}, this);
    return this._pouchFind(query, null, encrypted)
        .then((docs: any) => {
            json.docs = docs.map((docData: any) => {
                delete docData._rev;
                delete docData._attachments;
                return docData;
            });
            return json;
        });
};

function importDumpRxCollection(this: any, exportedJSON: any): Promise<any> {
    // check schemaHash
    if (exportedJSON.schemaHash !== this.schema.hash) {
        throw newRxError('JD2', {
            schemaHash: exportedJSON.schemaHash,
            own: this.schema.hash
        });
    }

    // check if passwordHash matches own
    if (
        exportedJSON.encrypted &&
        exportedJSON.passwordHash !== hash(this.database.password)
    ) {
        throw newRxError('JD3', {
            passwordHash: exportedJSON.passwordHash,
            own: hash(this.database.password)
        });
    }

    const importFns = exportedJSON.docs
        // decrypt
        .map((doc: any) => this._crypter.decrypt(doc))
        // validate schema
        .map((doc: any) => this.schema.validate(doc))
        // import
        .map((doc: any) => {
            return this._pouchPut(doc).then(() => {
                const primary = doc[this.schema.primaryPath];
                // emit changeEvents
                const emitEvent = createChangeEvent(
                    'INSERT',
                    this.database,
                    this,
                    null,
                    doc
                );
                emitEvent.data.doc = primary;
                this.$emit(emitEvent);
            });
        });
    return Promise.all(importFns);
}

export const rxdb = true;
export const prototypes = {
    RxDatabase: (proto: any) => {
        proto.dump = dumpRxDatabase;
        proto.importDump = importDumpRxDatabase;
    },
    RxCollection: (proto: any) => {
        proto.dump = dumpRxCollection;
        proto.importDump = importDumpRxCollection;
    }
};

export const overwritable = {};

export default {
    rxdb,
    prototypes,
    overwritable
};
