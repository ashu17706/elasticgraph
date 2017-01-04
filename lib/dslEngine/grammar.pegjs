{
  'use strict'
  const _ = require('lodash')
}

start
  = conditionalStatement / statement

statement
  = get / search / async / index / link / unlink/ assignment / unset / iterate / stopHere / display

conditionalStatement = ('if' / 'If') space condition:booleanExpression space* (',' / space)? space* instruction:statement '\.'? space* elseStatement:(('E' / 'e')'lse' start)? {
	return {
		command: 'conditionalStatement',
		condition: condition,
		instruction: instruction,
		elseInstruction: elseStatement && elseStatement[1]
	}	
}

link
  = 'link' e1:word space+ 'with' space+ e2:word space+ 'as' space+ e1ToE2Relation:word {
      return {
        command: 'link',
        e1: e1,
        e2: e2,
        e1ToE2Relation: e1ToE2Relation
      }
    }

unlink
  = 'unlink' e1:word space+ 'with' space+ e2:word space+ 'as' space+ e1ToE2Relation:word {
      return {
        command: 'unlink',
        e1: e1,
        e2: e2,
        e1ToE2Relation: e1ToE2Relation
      }
    }

unset
  = 'unset' entityWithProperty:word  deepUpdate:('\.'? space? 'Do deep update' '.'?)? {
    return {
      command: 'unset',
      docWithPath: entityWithProperty,
      deepUpdate: deepUpdate
    }
  }

add
  = update: memUpdate {
    return update
  }

addToSet
  = update: memUpdate {
    return update
  }

memUpdate
  = command:word val:word space+ ('at' / 'in' / 'to') space+ docWithPath:word deepUpdate:('.' space? 'Do deep update' '.'?)? {
      return {
        command: command,
        docWithPath: docWithPath,
        deepUpdate: deepUpdate,
        value: val
      }
    }

assignment
  = assignee:word (' is' / ' are') space* value:jsonOrWord conditionalAssignment:conditionalAssignment? deepUpdate:('\.'? space? 'Do deep update' '.'?)?  {
    const res = {
      command: 'assignment',
      assignee: assignee,
      assignment: value,
      deepUpdate: deepUpdate
    }
    if (conditionalAssignment) {
      _.extend(res, conditionalAssignment)
    }
    return res
  }

conditionalAssignment
  = ' if' condition:booleanExpression '.' space* elseAssignment:('Else ' ('is' / 'are') jsonOrWord)? '.'? {
    return {
      condition: condition,
      elseAssignment: elseAssignment && _.last(elseAssignment),
    }
  }

booleanExpression
  = expr:(isOneOf / emptinessCheck / isEqual) {
    return expr
  }

isEqual
  = left:word ' is' right:(!'\?' word) strict:' strict'? space* { 
    return {
      command: 'boolExpression',
      subCommand: 'isEqual',
      left: left,
      right: right[1],
      strict: strict
    }
  }

isOneOf = left:word ' is one of' list:((!'\?' word) (' or ' (!'\?' word))*) strict:' strict'? { 
		//list: [[null,"eitherThis"],[[" or ",[null,"orThis"]],[" or ",[null,"orThat"]]]]
		let right
		if (list[1]) {
			right = list[1].map((entry) => entry[1]) //Strip or
			right = right.map((entry) => entry[1]) //Strip null
			right.push(list[0][1])
		} else {
			right = list[0][1]
		}
    return {
      command: 'boolExpression',
      subCommand: 'isOneOf',
      left: left,
			right: right,
      strict: strict
    }
  }


emptinessCheck
  = val:jsonOrWord ' is' negation:' not'? ' empty' {
    return {
      command: 'boolExpression',
      subCommand: 'emptinessCheck',
      val: val,
      negation: negation
    }
  }

index
  = 'index' entity:word type:(' as type' word)? {
      return {
        command: 'index',
        entity: entity,
        type: type && type[1]
      }
    }

async
  = 'async' func:word args:(!" as" word)+ space+ 'as' as:word {
     return {
        command: 'async',
        func: func,
        args: _(args).flatten().compact().value(),
        as: as
      }
    }

get
  = 'get' type:word id:word as:as? ('.'/space)* joins:joins? {
      return _.omit({
        command: 'get',
        type: type,
        id: id,
        as: as,
        joins: joins && joins.joins
      }, _.isUndefined)
    }

search
  = 'search' oneOnly:' first'? type:word where:where as:as? '.'? space* joins:joins? space* [\.]? space* createIfNeeded:('Create if not exists' '.'?)? {
      if (as && as.endsWith('.')) {
        as = as.substr(0, as.length -1)
      }
      return _.omit({
        command: 'search',
        type: type,
        where: where,
        getFirst: oneOnly,
        as: as,
        joins: joins && joins.joins,
        createIfNeeded: createIfNeeded
      }, _.isUndefined)
    }

iterate
  = 'iterate over' index:word where:where? as:as? space* '.'? space* from:skipN? space* size:getN? space* flush:('Flush at end' / ('Flush every ' flushEvery:[0-9]+ ' cycles'))? '.'? space* wait:('Wait for' space+ [0-9]+ space+ 'millis')? '.'?{
    return {
      command: 'iterateOverIndex',
      index: index,
      as: as || index.slice(0, -1),
      batchSize: size,
      from: from,
      wait: wait && Number.parseInt(wait[2].join('')),
      where: where,
      flushAtEnd: flush === 'Flush at end',
      flushEvery: flush && flush !== 'Flush at end' && Number.parseInt(flush[1].join(''))
    }
  } 

skipN
  = [S/s] 'kip' space+ size:word space* '.'? {
    return size
  }
getN
  = [G/g] 'et' space+ size:word space+ 'at a time' '.'? {
    return size
  }

joins
  = 'Join from' space+ joinType:word {
    return {
      joins: joinType
    }
  }

where
  = ' where ' jsonOrWord:jsonOrWord {
      return jsonOrWord
    }

stopHere = ('S' / 's')'top here' {
	return {
		command: 'stopHere'
	}
}

display
	= [D/d] 'isplay' space+ args:(word ','? space*)+ '.'? {  
    return {
			command: 'display',
			args: args.map((arg) => arg[0])
		}
  }

space
  = ' ' / '\t'

word
  = '"'? space? w:(singleWord ('.' singleWord)*) '"'? {
    const firstWord = w[0]
    if (_.isEmpty(w[1])) {
      return firstWord
    }
    const restWords = w[1].map((entry) => entry[1])
    return firstWord + '.' + restWords.join('.')
  }

singleWord
  = w:(letter / [\*_\$\-])+ {
    const word = w.join('').trim()
    if (/^\d+$/.test(word)) {
      return +word
    } else {
      return word
    }
  }

json
  = jsonObject / jsonArray

jsonObject
  = '{' p:pair* '}' {
      var result = "{" + _(p).flatten().compact().value().join(', ') + "}"
      return JSON.parse(result)
    }

jsonArray
  = '[' list:(jsonOrWord ','?)* ']' {
    let val =  _.map(list, (value) => value[0])
    return val
  }

pair
  = key:word ':' space+ val:(word / string / json) ','?{
      key = key.startsWith('"') ? key : '"' + key + '"'
      if (_.isNumber(val) || _.isBoolean(val) || _.isUndefined(val) || _.isNull(val) || _.startsWith(val, '"')) {
        return key + ': ' + val
      }
      return key + ': ' + ('"' + val + '"')
    }

jsonOrWord
  = val:(json / (!'if' word)) {
    return _.isArray(val) && _.compact(val)[0] || val
  }


string
  = '"' w:word '"' {
    return '"' + w + '"'
  }

letter
  = [a-zA-Z0-9]

as
  = ' as' varName:word {
      return varName
    }

/**
    [
    'at ease',
    'get contentPersonRole where {contentId: this._id} as cpr',
    'get content audioToContent.Content_id with ',
    'update event content.Event_id,
    'push speaker to event.speakers',
    'push this.Language_id to event.languages',
    ]

**/
