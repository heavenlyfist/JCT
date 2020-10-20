import React, { Fragment, useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import api from '../utils/api';
import Spinner from './layout/Spinner';
import CompList from "./CompList";

class Search extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			select: "selectTags"
		}
	}
	
	render() {
		var lst = [];
		// for(var i=0; i < 10; i++) {
			// lst.push({
				// _id:"a0874hghyrs0re"+i,
				// title:"Title"+i,
				// tags:"tag1, tag2",
				// date:(new Date(1601311341629)).toString(),
				// time:"4m33s"
			// })
		// }
		// var res = new Promise((res,rej) => 
			// setTimeout(() => res({data: lst}), 2000));
		var res = api.get("/compositions")
		return (
		<Fragment>
			<div style={{textAlign:"center"}}>
				<input type="text" id="search-bar" placeholder="Search"/>
				<button style={{padding:"4px 7px",fontWeight:"bold"}}>&gt;</button>
			</div>
			<div style={{textAlign:"center",borderBottom:"1px solid gray",padding:"10px 0px"}}>
				<div className="search-params-button">Tags</div>
				<div className="search-params-button">Composer</div>
			</div>
			<CompList list={res} />
		</Fragment>
		);
	}
}

export default Search;