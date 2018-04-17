import Proxy from './Proxy';


import on_finished from 'on-finished';
import http from 'http';
import pump from 'pump';
import { hri } from "human-readable-ids";

import BindingAgent from './BindingAgent';

const NoOp = () => {};


class ClientManager {
    constructor(opt) {
        this.opt = opt;

        this.reqId = 0;

       
        this.clients = Object.create(null);

        // statistics
        this.stats = {
            tunnels: 0
        };
    }

    
    async newClient (id) {
        const clients = this.clients;
        const stats = this.stats;

        
        if (clients[id]) {
            id = hri.random();
        }

        const popt = {
            id: id,
            max_tcp_sockets: this.opt.max_tcp_sockets
        };

        const client = Proxy(popt);

        clients[id] = client;

        client.on('end', () => {
            --stats.tunnels;
            delete clients[id];
        });

        return new Promise((resolve, reject) => {
            
            client.start((err, info) => {
                if (err) {
                   
                    delete clients[id];
                    reject(err);
                    return;
                }

                ++stats.tunnels;
                info.id = id;
                resolve(info);
            });
        });
    }

    hasClient(id) {
        return this.clients[id];
    }

   
    handleRequest(clientId, req, res) {
        const client = this.clients[clientId];
        if (!client) {
            return;
        }

        const reqId = this.reqId;
        this.reqId = this.reqId + 1;

        let endRes = () => {
            endRes = NoOp;
            res.end();
        };

        on_finished(res, () => {
            endRes = NoOp;
        });

        client.nextSocket((clientSocket) => {
           
            if (endRes === NoOp) {
                return;
            }

           
            if (!clientSocket) {
                endRes();
                return;
            }

            const agent = new BindingAgent({
                socket: clientSocket,
            });

            const opt = {
                path: req.url,
                agent: agent,
                method: req.method,
                headers: req.headers
            };

            return new Promise((resolve) => {
               
                const clientReq = http.request(opt, (clientRes) => {
                  
                    res.writeHead(clientRes.statusCode, clientRes.headers);

                   
                    pump(clientRes, res, (err) => {
                        endRes();
                        resolve();
                    });
                });

                
                pump(req, clientReq, (err) => {
                    if (err) {
                        endRes();
                        resolve();
                    }
                });
            });
        });
    }

   
    handleUpgrade(clientId, req, sock) {
        const client = this.clients[clientId];
        if (!client) {
            return;
        }

        client.nextSocket(async (clientSocket) => {
            if (!sock.readable || !sock.writable) {
                sock.end();
                return;
            }

           
            if (!clientSocket) {
                sock.end();
                return;
            }

            // avoids having to rebuild the request and handle upgrades via the http client
            const arr = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
            for (let i=0 ; i < (req.rawHeaders.length-1) ; i+=2) {
                arr.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}`);
            }

            arr.push('');
            arr.push('');

            clientSocket.pipe(sock).pipe(clientSocket);
            clientSocket.write(arr.join('\r\n'));

            await new Promise((resolve) => {
                sock.once('end', resolve);
            });
        });
    }
}

export default ClientManager;
