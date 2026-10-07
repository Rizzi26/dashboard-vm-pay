-- Carga manual: entrada de estoque montada à mão, sem cupom legível.
--
-- O cupom de contingência que a SEFAZ recusa, a nota de papel do atacado, a
-- compra sem nota: o operador vai adicionando produtos do sistema e lança. O
-- registro fica em core.purchase_receipt como qualquer cupom (mesmo histórico,
-- mesma ficha do produto, mesma busca da prateleira), com source 'avulsa'.
--
-- Sem cupom não há chave de acesso, e o CNPJ do emitente vinha DA chave. Os
-- dois deixam de ser obrigatórios só para a carga avulsa: qrcode e manual
-- continuam exigindo a chave, que é a trava contra carregar a mesma compra
-- duas vezes (unique (org_id, access_key) não colide com nulo).

alter type core.receipt_source add value if not exists 'avulsa';

alter table core.purchase_receipt
    alter column access_key drop not null,
    alter column supplier_tax_id drop not null;

-- Compara como texto: o valor novo do enum não pode ser usado na mesma
-- transação que o criou ("unsafe use of new value"), e o workflow aplica
-- cada migration numa transação só. ::text não passa pela entrada do enum.
alter table core.purchase_receipt
    add constraint purchase_receipt_chave_ou_avulsa
    check (source::text = 'avulsa' or (access_key is not null and supplier_tax_id is not null));
